export async function enableOffline(admin = false) {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
    if (admin) {
      const registration = await navigator.serviceWorker.ready;
      registration.active?.postMessage({type:"cache-admin"});
    }
  } catch {
    // The application still works online in browsers that disable service workers.
  }
}
