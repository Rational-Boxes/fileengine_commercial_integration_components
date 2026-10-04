// SPDX-License-Identifier: MIT
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  parseShareSrc, renderingFor, playerUrl, acceptFrameMessage, eventDetail, pickSource,
  absolutise, boxStyle, quantise, bitsToBase64,
} from "../src/media-share-model.js"

const UID = "3f2a1b9c-0d4e-4f5a-8b6c-7d8e9f0a1b2c"

test("parses the media-origin URL and the /s/ form, and nothing else", () => {
  assert.deepEqual(parseShareSrc(`https://acme-media.example.com/media/v1/${UID}?k=S3cr_t`),
    { origin: "https://acme-media.example.com", linkUid: UID, secret: "S3cr_t" })
  assert.deepEqual(parseShareSrc(`https://acme-media.example.com/s/${UID}.S3cr_t`),
    { origin: "https://acme-media.example.com", linkUid: UID, secret: "S3cr_t" })
  for (const bad of [`http://evil.example/media/v1/${UID}?k=x`, `https://x/media/v1/${UID}`,
                     "https://x/media/v1/not-a-uid?k=x", "javascript:alert(1)", "", null]) {
    assert.equal(parseShareSrc(bad), null, String(bad))
  }
  // Loopback http is accepted for local development only.
  assert.equal(parseShareSrc(`http://localhost:8101/media/v1/${UID}?k=x`).origin, "http://localhost:8101")
})

test("the door decides the shape: only a plainly open link renders in-page", () => {
  assert.equal(renderingFor({ requires: "none" }), "inline")
  assert.equal(renderingFor({ requires: "email" }), "iframe")
  assert.equal(renderingFor({ requires: "code" }), "iframe")
  assert.equal(renderingFor({}), "iframe")                     // unknown: framed (safe)
  assert.equal(renderingFor(null), "iframe")
})

test("the framed player names the host origin it may talk to", () => {
  const u = new URL(playerUrl({ origin: "https://m.example", linkUid: UID, secret: "s" },
                              { parent: "https://host.example", autoplay: true }))
  assert.equal(u.origin + u.pathname, `https://m.example/media/v1/player/${UID}`)
  assert.equal(u.searchParams.get("parent"), "https://host.example")
  assert.equal(u.searchParams.get("autoplay"), "true")
})

test("frame messages are believed only from the door's origin, and only ours", () => {
  const ok = { origin: "https://m.example", data: { type: "fe:media-play" } }
  assert.equal(acceptFrameMessage(ok, "https://m.example"), true)
  assert.equal(acceptFrameMessage({ ...ok, origin: "https://evil.example" }, "https://m.example"), false)
  assert.equal(acceptFrameMessage({ ...ok, data: { type: "anything-else" } }, "https://m.example"), false)
  assert.equal(acceptFrameMessage({ ...ok, data: null }, "https://m.example"), false)
})

test("an identified event never carries the address", () => {
  assert.deepEqual(eventDetail({ type: "fe:media-identified", email: "a@b.c", requires: "email" }),
                   { requires: "email" })
})

test("the first playable source, in the server's order", () => {
  const s = [{ quality: "hd", mime: "video/webm" }, { quality: "sd", mime: "video/mp4" }]
  assert.equal(pickSource(s, (m) => m === "video/mp4").quality, "sd")
  assert.equal(pickSource(s, () => true).quality, "hd")
  assert.equal(pickSource([], () => true), null)
  assert.equal(absolutise({ origin: "https://m" }, [{ url: "/media/v1/x" }])[0].url, "https://m/media/v1/x")
})

test("sizing from width/height/aspect", () => {
  assert.deepEqual(boxStyle({ width: "720" }), { width: "720px", aspectRatio: "16 / 9" })
  assert.deepEqual(boxStyle({ aspect: "4:3" }), { width: "100%", aspectRatio: "4 / 3" })
  assert.deepEqual(boxStyle({ width: "640", height: "360" }), { width: "640px", height: "360px" })
  assert.deepEqual(boxStyle({ width: "100%;background:url(x)" }), { width: "100%", aspectRatio: "16 / 9" })
})

test("the coverage bitmap matches the server's decoding (MSB first)", () => {
  assert.equal(quantise([[0, 1], [9, 10]], 10), "1000000001")
  assert.equal(atob(bitsToBase64("10000000")), "\x80")
})
