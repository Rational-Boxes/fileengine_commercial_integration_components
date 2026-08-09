/*
 * Minimal async message bus for custom-element-based components
 * system and optional visibility-based hydration.
 * (c) 2024 James Hickman <jamesATjameshickmanDOTnet>
 * MIT License
 */
const hydration = {};
const cache = {};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const el = entry.target;
            if (el.id && hydration[el.id] === false) {
                hydration[el.id] = true;
                if ('_start' in el) {
                    el._start.bind(el)();
                }
                observer.unobserve(el);
            }
        }
    });
}, {
    root: null, // Use the viewport as the root
    rootMargin: '0px',
    threshold: 0.1 // Trigger when at least 10% of the target is visible
});

/**
 * Start the component hydration support.
 * Any component with the jsom attribute
 * will be tracked, and when it becomes visiable the
 * _start() method is caled for the component to fully
 * activate
 */
const init_hydration_lifecycle = () => {
    const els_components = document.querySelectorAll("[jsum]");
    for (const el_component of els_components) {
        hydration[el_component.id] = false;
        observer.observe(el_component);
    }
}

/**
 * Call a method on multiple Custom Elements instances by query-selector.
 * @param {object} callData
 * @param {string} callData.target - required, name of the method to find and call
 * @param {string} callData.query - required, selector to find elements
 * @param {HTMLElement} callData.root - optional, element to query
 * @param {Array} callData.params - optional, parameters to pass to the target methods
 */
const multicall = async (co) => {
    let is_root_document = false;
    let cached = false;
    let key = null;
    if (co.root === undefined) {
        co.root = document;
        is_root_document = true;
    }
    if (co.params === undefined) {
        co.params = [];
    }
    let els = [];
    if (is_root_document) {
        key = co.query + '/' + co.target;
        if (cache.hasOwnProperty(key)) {
            cached = true;
            els = cache[key];
        } else {
            els = co.root.querySelectorAll(co.query);
        }
    } else {
        els = co.root.querySelectorAll(co.query);
    }

    // Create an array of promises for each matching element
    const promises = Array.from(els).map(async (el) => {
        if (co.target in el && typeof el[co.target] === 'function') {
            if (is_root_document && !cached) {
                if (!cache.hasOwnProperty(key)) {
                    cache[key] = [];
                }
                cache[key].push(el);
            }
            if (el.id) {
                if (el.id in hydration && hydration[el.id] === false) {
                    hydration[el.id] = true;
                    observer.unobserve(el);
                    if ("_start" in el) await el._start.bind(el)();
                }
            }
            try {
                const result = await el[co.target].bind(el)(...co.params);
                return { result, source: el };
            } catch (error) {
                console.error(`Error in multicall for element ${el.id || 'unknown'}:`, error);
                return { error, source: el };
            }
        }
        return null;
    });

    // Wait for all promises to resolve
    const results = await Promise.all(promises);

    // Filter out null results (elements that didn't match the criteria)
    return results.filter(result => result !== null);
};

/**
 * In the case of dynamic elements added to the DOM
 * delete the cached query results so the cache list
 * is recreated for the operation.
 * 
 * @param {string} method_name 
 */
const clear_cache_for = (method_name) => {
    for (const key in cache) {
        const method = key.split('/')[1];
        if (method === method_name) {
            delete cache[key];
        }
    }
}

export {multicall, clear_cache_for, init_hydration_lifecycle};