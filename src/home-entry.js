import { mountHousehold } from "./home-ui.js";
import { openHouseholdTest } from "./home-scan.js";
import { readHome, householdSummary } from "./home-store.js";
import { openFamilyExport } from "./field-report.js";
import { enableOffline } from "./offline.js";

const root = document.querySelector("#household-app");
mountHousehold(root,{
  onTest:openHouseholdTest,
  onExit:()=>location.assign("/"),
  onReport:()=>openFamilyExport(async()=>{
    const state=await readHome();
    return {id:state.householdId, revision:state.revision, summary:householdSummary(state)};
  })
});
enableOffline();
