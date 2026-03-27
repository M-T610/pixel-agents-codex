import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout, SpriteData } from '../src/office/types.js';
import { CharacterState, TileType } from '../src/office/types.js';

function sprite(token: string): SpriteData {
  return [[token]];
}

function buildSyntheticCatalog(): void {
  buildDynamicCatalog({
    catalog: [
      {
        id: 'TEST_DESK',
        label: 'Desk',
        category: 'desks',
        width: 1,
        height: 1,
        footprintW: 1,
        footprintH: 1,
        isDesk: true,
      },
      {
        id: 'TEST_CHAIR',
        label: 'Chair',
        category: 'chairs',
        width: 1,
        height: 1,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
      },
      {
        id: 'LAPTOP_TEST_FRONT_OFF',
        label: 'Laptop - Off',
        category: 'electronics',
        width: 1,
        height: 1,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        groupId: 'LAPTOP_TEST',
        orientation: 'front',
        state: 'off',
        canPlaceOnSurfaces: true,
      },
      {
        id: 'LAPTOP_TEST_FRONT_ON',
        label: 'Laptop - On',
        category: 'electronics',
        width: 1,
        height: 1,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        groupId: 'LAPTOP_TEST',
        orientation: 'front',
        state: 'on',
        canPlaceOnSurfaces: true,
      },
      {
        id: 'LAPTOP_TEST_BACK',
        label: 'Laptop - Back',
        category: 'electronics',
        width: 1,
        height: 1,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        groupId: 'LAPTOP_TEST',
        orientation: 'back',
        canPlaceOnSurfaces: true,
      },
      {
        id: 'LAPTOP_TEST_SIDE',
        label: 'Laptop - Side',
        category: 'electronics',
        width: 1,
        height: 1,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        groupId: 'LAPTOP_TEST',
        orientation: 'side',
        mirrorSide: true,
        canPlaceOnSurfaces: true,
      },
      {
        id: 'PC_TEST_FRONT_OFF',
        label: 'PC - Off',
        category: 'electronics',
        width: 1,
        height: 1,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        groupId: 'PC_TEST',
        orientation: 'front',
        state: 'off',
        canPlaceOnSurfaces: true,
      },
      {
        id: 'PC_TEST_FRONT_ON',
        label: 'PC - On',
        category: 'electronics',
        width: 1,
        height: 1,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        groupId: 'PC_TEST',
        orientation: 'front',
        state: 'on',
        canPlaceOnSurfaces: true,
      },
      {
        id: 'PC_TEST_BACK',
        label: 'PC - Back',
        category: 'electronics',
        width: 1,
        height: 1,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        groupId: 'PC_TEST',
        orientation: 'back',
        canPlaceOnSurfaces: true,
      },
      {
        id: 'PC_TEST_SIDE',
        label: 'PC - Side',
        category: 'electronics',
        width: 1,
        height: 1,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        groupId: 'PC_TEST',
        orientation: 'side',
        mirrorSide: true,
        canPlaceOnSurfaces: true,
      },
    ],
    sprites: {
      TEST_DESK: sprite('DESK'),
      TEST_CHAIR: sprite('CHAIR'),
      LAPTOP_TEST_FRONT_OFF: sprite('L_OFF'),
      LAPTOP_TEST_FRONT_ON: sprite('L_ON'),
      LAPTOP_TEST_BACK: sprite('L_BACK'),
      LAPTOP_TEST_SIDE: sprite('L_SIDE'),
      PC_TEST_FRONT_OFF: sprite('P_OFF'),
      PC_TEST_FRONT_ON: sprite('P_ON'),
      PC_TEST_BACK: sprite('P_BACK'),
      PC_TEST_SIDE: sprite('P_SIDE'),
    },
  });
}

function createLaptopFacingLayout(): OfficeLayout {
  return {
    version: 1,
    cols: 3,
    rows: 4,
    tiles: Array.from({ length: 12 }, () => TileType.FLOOR_1),
    furniture: [
      { uid: 'desk', type: 'TEST_DESK', col: 1, row: 1 },
      { uid: 'chair', type: 'TEST_CHAIR', col: 1, row: 2 },
      { uid: 'laptop', type: 'LAPTOP_TEST_FRONT_OFF', col: 1, row: 1 },
    ],
  };
}

test('front-facing workstations are treated as work seats and turn on when active', () => {
  buildSyntheticCatalog();

  for (const [type, offToken, onToken] of [
    ['LAPTOP_TEST_FRONT_OFF', 'L_OFF', 'L_ON'],
    ['PC_TEST_FRONT_OFF', 'P_OFF', 'P_ON'],
  ] as const) {
    const layout = createLaptopFacingLayout();
    layout.furniture[2] = { ...layout.furniture[2], type };
    const officeState = new OfficeState(layout);

    assert.equal(
      officeState.workSeatIds.size,
      1,
      `expected the chair facing ${type} to be a work seat`,
    );

    officeState.addAgent(1, 0, 0);

    const before = officeState.furniture.find((item) =>
      item.sprite[0]?.[0]?.startsWith(offToken[0]),
    );
    assert.ok(before, `expected a rendered device instance for ${type} before activation`);
    assert.equal(before.sprite[0][0], offToken);

    officeState.setAgentActive(1, true);

    const after = officeState.furniture.find((item) =>
      item.sprite[0]?.[0]?.startsWith(offToken[0]),
    );
    assert.ok(after, `expected a rendered device instance for ${type} after activation`);
    assert.equal(after.sprite[0][0], onToken);
  }
});

test('agents prefer a workstation-facing seat over a generic seat', () => {
  buildSyntheticCatalog();

  for (const type of ['LAPTOP_TEST_FRONT_OFF', 'PC_TEST_FRONT_OFF']) {
    const officeState = new OfficeState({
      version: 1,
      cols: 5,
      rows: 4,
      tiles: Array.from({ length: 20 }, () => TileType.FLOOR_1),
      furniture: [
        { uid: 'desk-work', type: 'TEST_DESK', col: 1, row: 1 },
        { uid: 'chair-work', type: 'TEST_CHAIR', col: 1, row: 2 },
        { uid: 'device', type, col: 1, row: 1 },
        { uid: 'desk-generic', type: 'TEST_DESK', col: 3, row: 1 },
        { uid: 'chair-generic', type: 'TEST_CHAIR', col: 3, row: 2 },
      ],
    });

    officeState.addAgent(1, 0, 0);

    const agent = officeState.characters.get(1);
    assert.ok(agent, `expected the agent to be created for ${type}`);
    assert.equal(agent.seatId, 'chair-work');
  }
});

test('seats facing the back of a workstation are not treated as work seats', () => {
  buildSyntheticCatalog();

  for (const type of ['LAPTOP_TEST_BACK', 'PC_TEST_BACK']) {
    const officeState = new OfficeState({
      version: 1,
      cols: 3,
      rows: 4,
      tiles: Array.from({ length: 12 }, () => TileType.FLOOR_1),
      furniture: [
        { uid: 'desk', type: 'TEST_DESK', col: 1, row: 1 },
        { uid: 'chair', type: 'TEST_CHAIR', col: 1, row: 2 },
        { uid: 'device', type, col: 1, row: 1 },
      ],
    });

    assert.equal(
      officeState.workSeatIds.size,
      0,
      `${type} should not create a work seat from the back side`,
    );

    officeState.addAgent(1, 0, 0);
    officeState.setAgentActive(1, true);

    const token = type.startsWith('LAPTOP_') ? 'L_BACK' : 'P_BACK';
    const activeToken = type.startsWith('LAPTOP_') ? 'L_ON' : 'P_ON';
    const device = officeState.furniture.find((item) => item.sprite[0]?.[0]?.startsWith(token[0]));
    assert.ok(device, `expected a rendered device instance for ${type}`);
    assert.notEqual(device.sprite[0][0], activeToken);
  }
});

test('side workstations only count from the screen-facing side', () => {
  buildSyntheticCatalog();

  const layouts = [
    {
      type: 'LAPTOP_TEST_SIDE',
      expectedSeatId: 'chair-left',
    },
    {
      type: 'LAPTOP_TEST_SIDE:left',
      expectedSeatId: 'chair-right',
    },
    {
      type: 'PC_TEST_SIDE',
      expectedSeatId: 'chair-left',
    },
    {
      type: 'PC_TEST_SIDE:left',
      expectedSeatId: 'chair-right',
    },
  ];

  for (const { type, expectedSeatId } of layouts) {
    const officeState = new OfficeState({
      version: 1,
      cols: 5,
      rows: 3,
      tiles: Array.from({ length: 15 }, () => TileType.FLOOR_1),
      furniture: [
        { uid: 'desk', type: 'TEST_DESK', col: 2, row: 1 },
        { uid: 'chair-left', type: 'TEST_CHAIR', col: 1, row: 1 },
        { uid: 'chair-right', type: 'TEST_CHAIR', col: 3, row: 1 },
        { uid: 'device', type, col: 2, row: 1 },
      ],
    });

    assert.deepEqual(
      [...officeState.workSeatIds],
      [expectedSeatId],
      `${type} should only expose ${expectedSeatId} as a work seat`,
    );
  }
});

test('agents do not claim a generic seat or type when no valid workstation seat exists', () => {
  buildSyntheticCatalog();

  const officeState = new OfficeState({
    version: 1,
    cols: 3,
    rows: 4,
    tiles: Array.from({ length: 12 }, () => TileType.FLOOR_1),
    furniture: [
      { uid: 'desk', type: 'TEST_DESK', col: 1, row: 1 },
      { uid: 'chair', type: 'TEST_CHAIR', col: 1, row: 2 },
      { uid: 'device', type: 'LAPTOP_TEST_BACK', col: 1, row: 1 },
    ],
  });

  officeState.addAgent(1, 0, 0);

  const agent = officeState.characters.get(1);
  assert.ok(agent, 'expected the agent to be created');
  assert.equal(agent.seatId, null);
  assert.notEqual(agent.state, CharacterState.TYPE);
});

test('subagents do not claim a generic seat or type when no valid workstation seat exists', () => {
  buildSyntheticCatalog();

  const officeState = new OfficeState({
    version: 1,
    cols: 3,
    rows: 4,
    tiles: Array.from({ length: 12 }, () => TileType.FLOOR_1),
    furniture: [
      { uid: 'desk', type: 'TEST_DESK', col: 1, row: 1 },
      { uid: 'chair', type: 'TEST_CHAIR', col: 1, row: 2 },
      { uid: 'device', type: 'LAPTOP_TEST_BACK', col: 1, row: 1 },
    ],
  });

  const subId = officeState.addSubagent(1, 'tool-1');
  const subagent = officeState.characters.get(subId);

  assert.ok(subagent, 'expected the subagent to be created');
  assert.equal(subagent.seatId, null);
  assert.notEqual(subagent.state, CharacterState.TYPE);
});

test('active agents stop typing when a layout rebuild removes their valid workstation seat', () => {
  buildSyntheticCatalog();

  const officeState = new OfficeState(createLaptopFacingLayout());
  officeState.addAgent(1, 0, 0);

  const agent = officeState.characters.get(1);
  assert.ok(agent, 'expected the agent to be created');
  assert.equal(agent.seatId, 'chair');
  assert.equal(agent.state, CharacterState.TYPE);

  officeState.rebuildFromLayout({
    version: 1,
    cols: 3,
    rows: 4,
    tiles: Array.from({ length: 12 }, () => TileType.FLOOR_1),
    furniture: [
      { uid: 'desk', type: 'TEST_DESK', col: 1, row: 1 },
      { uid: 'chair', type: 'TEST_CHAIR', col: 1, row: 2 },
      { uid: 'device', type: 'LAPTOP_TEST_BACK', col: 1, row: 1 },
    ],
  });

  assert.equal(agent.seatId, null);
  assert.notEqual(agent.state, CharacterState.TYPE);
});

test('active agents cannot be reassigned to a non-work seat', () => {
  buildSyntheticCatalog();

  const officeState = new OfficeState({
    version: 1,
    cols: 7,
    rows: 4,
    tiles: Array.from({ length: 28 }, () => TileType.FLOOR_1),
    furniture: [
      { uid: 'desk-work', type: 'TEST_DESK', col: 1, row: 1 },
      { uid: 'chair-work', type: 'TEST_CHAIR', col: 1, row: 2 },
      { uid: 'device', type: 'LAPTOP_TEST_FRONT_OFF', col: 1, row: 1 },
      { uid: 'desk-generic', type: 'TEST_DESK', col: 5, row: 1 },
      { uid: 'chair-generic', type: 'TEST_CHAIR', col: 5, row: 2 },
    ],
  });

  officeState.addAgent(1, 0, 0);
  officeState.reassignSeat(1, 'chair-generic');

  const agent = officeState.characters.get(1);
  assert.ok(agent, 'expected the agent to be created');
  assert.equal(agent.seatId, 'chair-work');
});
