import { CarProjectStore } from '../src/state/CarProjectStore';
import { DEFAULT_FIXTURES, PART_ORDER } from '../src/regulations/fia2026';
import { CarDesignSnapshot, FixtureId } from '../src/types/aero';

console.log('=== TEST PR F: STUDIO HUD, V2 CONTROLS & DOCS ===\n');

const store = new CarProjectStore();

// 1. Test Macro / Detail Handle Level
console.log('1. Testing Handle Level toggling...');
if (store.activeHandleLevel !== 'macro') throw new Error(`Expected default handle level 'macro', got ${store.activeHandleLevel}`);
store.setActiveHandleLevel('detail');
if (store.activeHandleLevel !== 'detail') throw new Error(`Expected handle level 'detail' after toggle`);
store.setActiveHandleLevel('macro');
if (store.activeHandleLevel !== 'macro') throw new Error(`Expected handle level 'macro' after toggle`);
console.log('✓ Macro and Detail handle level toggling verified!\n');

// 2. Test Fixture Visibility Toggling
console.log('2. Testing Vehicle Fixture visibility...');
for (const f of DEFAULT_FIXTURES) {
  if (store.fixtures[f.id] !== true) throw new Error(`Expected fixture ${f.id} to be visible by default`);
}
store.setFixtureVisible('halo_structure', false);
if (store.fixtures['halo_structure'] !== false) throw new Error('Expected halo_structure to be hidden');
store.setFixtureVisible('halo_structure', true);
if (store.fixtures['halo_structure'] !== true) throw new Error('Expected halo_structure to be visible again');
console.log(`✓ All ${DEFAULT_FIXTURES.length} vehicle fixtures visibility controls verified!\n`);

// 3. Test V1 -> V2 Migration Toast
console.log('3. Testing V1 -> V2 Migration Toast...');
const legacyV1Snapshot: CarDesignSnapshot = {
  version: 1,
  name: 'Legacy V1 Test Spec',
  createdAt: Date.now(),
  carModelId: 'fia_2026_concept',
  parts: {} as Record<string, any>,
  paramValues: {} as Record<string, any>,
  proceduralElements: {} as Record<string, any>,
  wheelStance: { ...store.wheelStance },
  summary: {
    cl: 3.75,
    cd: 0.99,
    ldRatio: 3.78,
    copFrontPct: 45.8,
    downforceN: 16000,
    dragN: 4200,
  },
};

for (const id of PART_ORDER) {
  legacyV1Snapshot.parts[id] = store.parts[id].grid;
}

const loaded = store.loadDesignSnapshot(legacyV1Snapshot);
if (!loaded) throw new Error('Failed to load legacy V1 snapshot');
if (!store.migrationToast) throw new Error('Expected migrationToast to be set after legacy V1 load');
console.log(`- Migration Toast message: "${store.migrationToast}"`);
store.clearMigrationToast();
if (store.migrationToast !== null) throw new Error('Expected migrationToast to be cleared');
console.log('✓ Migration Toast notification cycle verified!\n');

// 4. Test Export / Import JSON with V2 Cages & Fixtures
console.log('4. Testing V2 JSON export / import...');
const exported = store.exportDesignJson();
const parsed = JSON.parse(exported);
if (parsed.version !== 2) throw new Error(`Expected exported version 2, got ${parsed.version}`);
if (!parsed.fixtures) throw new Error('Expected exported JSON to contain fixtures');
if (!parsed.cages) throw new Error('Expected exported JSON to contain cages');
const reimported = store.importDesignJson(exported);
if (!reimported) throw new Error('Failed to re-import exported JSON');
console.log('✓ V2 JSON export and re-import verified!\n');

console.log('=== ALL PR F STORE & CONTROLS TESTS PASSED PERFECTLY! ===');
