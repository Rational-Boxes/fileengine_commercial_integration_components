// SPDX-License-Identifier: MIT
import { API_REST } from "./api.js";

/**
 * Return a handler to recreate the Bearer token from the local system and update the API
 * Model.
 * 
 * @param {string} Domin of originating system
 * @param {string} Route to the end-point to regenerate the JWT
 * 
 * @returns {CallableFunction} Handler to start the Bearer token recreation process
 */
export function bearer_handler(local_domain, local_system_end_point) {
    const api = new API_REST(local_domain);
    api.define_endpoint(local_system_end_point, (response) => {
        if (response.ok) {
            api.set_bearer_token(response.body);
            api.recall();
        }
    });

    /**
     * Curry the state for acessing the local system
     * and return a function to register with the API
     */
    return () => {
        api.call(local_system_end_point);
    };
}