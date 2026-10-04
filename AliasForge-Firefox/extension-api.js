const isPromiseApi = Boolean(globalThis.browser);
const rawApi = globalThis.browser ?? globalThis.chrome;

async function invokeApi(method, ...args) {
    if (isPromiseApi) {
        return method(...args);
    }

    return new Promise((resolve, reject) => {
        try {
            method(...args, (result) => {
                const error = rawApi?.runtime?.lastError;
                if (error) {
                    reject(new Error(error.message));
                    return;
                }

                resolve(result);
            });
        } catch (error) {
            reject(error);
        }
    });
}

export function getExtensionApi() {
    if (!rawApi) {
        throw new Error("The WebExtension API is not available.");
    }

    return rawApi;
}

export function storageGet(key) {
    const api = getExtensionApi();
    return invokeApi(api.storage.local.get.bind(api.storage.local), key);
}

export function storageSet(value) {
    const api = getExtensionApi();
    return invokeApi(api.storage.local.set.bind(api.storage.local), value);
}

export function storageRemove(key) {
    const api = getExtensionApi();
    return invokeApi(api.storage.local.remove.bind(api.storage.local), key);
}

export function storageSyncAvailable() {
    return Boolean(rawApi?.storage?.sync);
}

export function storageSyncGet(key) {
    const api = getExtensionApi();
    if (!api.storage.sync) {
        throw new Error("storage.sync is not available in this browser.");
    }
    return invokeApi(api.storage.sync.get.bind(api.storage.sync), key);
}

export function storageSyncSet(value) {
    const api = getExtensionApi();
    if (!api.storage.sync) {
        throw new Error("storage.sync is not available in this browser.");
    }
    return invokeApi(api.storage.sync.set.bind(api.storage.sync), value);
}

export async function sendRuntimeMessage(message) {
    const api = getExtensionApi();
    const response = await invokeApi(api.runtime.sendMessage.bind(api.runtime), message);
    if (response?.error) throw new Error(response.message || response.error);
    if (response === undefined) throw new Error("The background process did not respond.");
    return response;
}

export function sendNativeMessage(message) {
    const api = getExtensionApi();
    return invokeApi(api.runtime.sendNativeMessage.bind(api.runtime), "application.id", message);
}

export function queryTabs(queryInfo) {
    const api = getExtensionApi();
    return invokeApi(api.tabs.query.bind(api.tabs), queryInfo);
}

export function getTab(tabId) {
    const api = getExtensionApi();
    return invokeApi(api.tabs.get.bind(api.tabs), tabId);
}

export function createTab(options) {
    const api = getExtensionApi();
    return invokeApi(api.tabs.create.bind(api.tabs), options);
}

export function sendTabMessage(tabId, message, options = {}) {
    const api = getExtensionApi();
    return invokeApi(api.tabs.sendMessage.bind(api.tabs), tabId, message, options);
}

export function permissionsSupported() {
    return Boolean(getExtensionApi().permissions?.request);
}

export function permissionsContains(permissions) {
    const api = getExtensionApi();
    return invokeApi(api.permissions.contains.bind(api.permissions), permissions);
}

export function permissionsRequest(permissions) {
    const api = getExtensionApi();
    return invokeApi(api.permissions.request.bind(api.permissions), permissions);
}
