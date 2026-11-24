import { enableOffline } from "./offline.js";

// Bookmarks from dashboard-only versions used hashes at the root.
const adminViews = ["#dashboard", "#map", "#tests", "#analysis", "#reminders"];
if (adminViews.includes(location.hash)) location.replace("/admin" + location.hash);
else enableOffline();
