import { loadDoc, deviceSettings } from './config/load.js';
import { createDocStore } from './config/store.js';
import { standardPages } from './config/presets.js';
import { createStationManager } from './station/manager.js';

// Start-up: load the config document, put it in the store, and keep one running
// station per document entry. The manager follows the store, so any later
// change to the document (the console handle below now, the service panel from
// step 08) adds, removes or rebuilds stations live.
export async function boot() {
  const { search } = location;
  const { doc, origin, problems } = await loadDoc({ search });
  for (const p of problems) console.warn(`[MARS] config ${p}`);

  const docStore = createDocStore({ doc, origin });
  const manager = createStationManager();
  // subscribed before React, so stations are in place when the page re-renders
  docStore.subscribe(() => manager.sync(docStore.getDoc().stations));
  manager.sync(docStore.getDoc().stations);

  // Debug handle for the devtools console, e.g.
  //   __mars.setDoc((d) => ({ ...d, stations: [...d.stations, { id: 'b', name: 'B-01', source: { kind: 'sim', seed: 3 } }] }))
  // setDoc throws on an invalid document and keeps the current one. App adds stats().
  window.__mars = {
    getDoc: docStore.getDoc,
    setDoc: docStore.setDoc,
    save: docStore.save,
    get origin() {
      return docStore.origin;
    },
    stations: manager.list,
    standardPages,
  };

  return { docStore, manager, device: deviceSettings(docStore.getDoc(), { search }) };
}
