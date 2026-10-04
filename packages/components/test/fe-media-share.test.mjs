// SPDX-License-Identifier: MIT
// <fe-media-share>: the shape follows the door, not the host; the token stays
// in the closure.
import { test, before } from "node:test"
import assert from "node:assert/strict"

const UID = "3f2a1b9c-0d4e-4f5a-8b6c-7d8e9f0a1b2c"
const DOOR = "https://acme-media.example.com"

class FakeNode {
  constructor(tag = "div") { this.tagName = tag.toUpperCase(); this._attrs = new Map(); this._l = {}; this.children = [] }
  setAttribute(n, v) { this._attrs.set(n, String(v)) }
  getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null }
  addEventListener(t, f) { (this._l[t] ||= []).push(f) }
  dispatchEvent(e) { (this._l[e.type] || []).forEach((f) => f(e)); return true }
  replaceChildren(...k) { this.children = k }
  canPlayType() { return "probably" }
  play() { return Promise.resolve() }
  pause() {}
}

class FakeRoot {
  constructor() { this._html = ""; this.nodes = {} }
  set innerHTML(h) {
    this._html = h
    this.nodes = { iframe: new FakeNode("iframe"), img: new FakeNode("img"),
                   button: new FakeNode("button"), ".b": new FakeNode("div") }
    this.nodes.iframe.contentWindow = { postMessage: (m, o) => FakeRoot.posted.push({ m, o }) }
  }
  get innerHTML() { return this._html }
  querySelector(s) { return this._html.includes(s === ".b" ? 'class="b"' : `<${s}`) ? this.nodes[s] : null }
}
FakeRoot.posted = []

class FakeElement extends FakeNode {
  constructor() { super("fe-media-share"); this.dataset = {} }
  attachShadow(opts) { this.shadowMode = opts.mode; this.shadow = new FakeRoot(); return this.shadow }
  get isConnected() { return true }
}

let FeMediaShare
const storage = new Map()
before(async () => {
  globalThis.HTMLElement = FakeElement
  globalThis.CustomEvent = class { constructor(t, i = {}) { this.type = t; this.detail = i.detail } }
  globalThis.document = { createElement: (t) => new FakeNode(t) }
  globalThis.location = { origin: "https://host.example" }
  globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} }
  globalThis.localStorage = { setItem: (k, v) => storage.set(k, v), getItem: (k) => storage.get(k) }
  globalThis.customElements = { get: () => null, define: () => {} }
  ;({ FeMediaShare } = await import("../src/fe-media-share.js"))
})

function json(status, body) { return { ok: status < 300, status, json: async () => body } }

async function mount(peek, attrs = {}, session) {
  const el = new FeMediaShare()
  const calls = []
  el.fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return url.includes("/session") ? json(200, session) : json(200, peek)
  }
  el.setAttribute("src", `${DOOR}/media/v1/${UID}?k=SECRET`)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  el.connectedCallback()
  await new Promise((r) => setTimeout(r, 0))
  return { el, calls }
}

const OPEN = { kind: "video", requires: "none", state: "ready", poster: `/media/v1/${UID}/poster` }

test("a gated link is FRAMED — and a host attribute cannot change that", async () => {
  for (const requires of ["email", "code"]) {
    const { el, calls } = await mount({ kind: "video", requires, state: "ready" },
                                      { mode: "inline", rendering: "inline" })
    assert.equal(el.rendering, "iframe")
    assert.match(el.shadow.nodes.iframe.src, new RegExp(`^${DOOR}/media/v1/player/${UID}\\?`))
    assert.match(el.shadow.nodes.iframe.src, /parent=https%3A%2F%2Fhost.example/)
    assert.equal(calls.length, 1, "nothing but the peek before the gate")
  }
})

test("an open link renders in-page, in a CLOSED shadow root", async () => {
  const { el } = await mount(OPEN)
  assert.equal(el.rendering, "inline")
  assert.equal(el.shadowMode, "closed")
  assert.match(el.shadow.innerHTML, /part="player"/)
})

test("nothing is rendered before the door has answered", async () => {
  const el = new FeMediaShare()
  let release
  el.fetchImpl = () => new Promise((r) => { release = r })
  el.setAttribute("src", `${DOOR}/media/v1/${UID}?k=S`)
  el.connectedCallback()
  assert.equal(el.rendering, null)
  assert.equal(el.shadow, undefined)
  release(json(200, OPEN))
})

test("the open-mode session token never reaches storage, an attribute or the dataset", async () => {
  const session = { session: "TOKEN-XYZ", sources: [{ quality: "hd", mime: "video/webm",
    url: `/media/v1/${UID}/content?q=hd&t=TOKEN-XYZ` }], beacon: `/media/v1/${UID}/playback?t=TOKEN-XYZ` }
  const { el, calls } = await mount(OPEN, {}, session)
  el.shadow.nodes.button._l.click[0]()
  await new Promise((r) => setTimeout(r, 0))
  assert.ok(calls.some((c) => c.url.includes("/session")), "a session was opened on play")
  assert.equal(calls.find((c) => c.url.includes("/session")).init.credentials, "omit")
  const everything = JSON.stringify([...el._attrs.entries(), el.dataset, [...storage.entries()]])
  assert.ok(!everything.includes("TOKEN-XYZ"), everything)
})

test("a bad src is an error, and fetches nothing", async () => {
  const el = new FeMediaShare()
  let fetched = false
  el.fetchImpl = async () => { fetched = true; return json(200, OPEN) }
  const events = []
  el.addEventListener("fe:media-error", (e) => events.push(e))
  el.setAttribute("src", "http://evil.example/whatever")
  el.connectedCallback()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(fetched, false)
  assert.equal(events.length, 1)
})

test("host commands to the frame name the door's origin, never '*'", async () => {
  FakeRoot.posted.length = 0
  const { el } = await mount({ kind: "video", requires: "email", state: "ready" })
  el.play()
  el.pause()
  assert.deepEqual(FakeRoot.posted.map((p) => p.o), [DOOR, DOOR])
  assert.deepEqual(FakeRoot.posted.map((p) => p.m.command), ["play", "pause"])
})
