// Devices page — auto-loads the device list on open and refreshes via socket events.
// The "Start Live Scan" panel has been removed; devices populate automatically.
(function () {
    async function loadDevices() {
        try {
            if (typeof fetchDeviceList === 'function') {
                const devices = await fetchDeviceList();
                if (Array.isArray(devices) && typeof applyDeviceResults === 'function') {
                    applyDeviceResults(devices);
                }
            }
        } catch (err) {
            console.warn('Auto device load failed:', err.message || err);
        }
    }

    document.addEventListener('DOMContentLoaded', loadDevices);
})();
