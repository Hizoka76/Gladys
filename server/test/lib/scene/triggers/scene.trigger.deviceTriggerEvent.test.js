const sinon = require('sinon').createSandbox();
const { expect } = require('chai');

const { assert, fake } = sinon;

const EventEmitter = require('events');
const StateManager = require('../../../../lib/state');
const SceneManager = require('../../../../lib/scene');
const { ACTIONS, EVENTS } = require('../../../../utils/constants');

const event = new EventEmitter();

// The trigger event a device trigger puts in the scope of the scene: the raw event
// (device_feature, last_value, previous_value) plus the name of the device the
// feature belongs to, so a scene with several opening sensors can tell which one
// fired ({{triggerEvent.device_name}}).
describe('Scene.triggers.deviceTriggerEvent', () => {
  let sceneManager;
  let message;
  let stateManager;

  const device = {
    setValue: fake.resolves(null),
  };

  const brain = {};

  const service = {
    getService: fake.returns(null),
  };

  const waitForQueue = () =>
    new Promise((resolve, reject) => {
      sceneManager.queue.start((e) => (e ? reject(e) : resolve()));
    });

  const addScene = (trigger) =>
    sceneManager.addScene({
      selector: 'gestion-des-ouvertures',
      active: true,
      actions: [
        [
          {
            type: ACTIONS.MESSAGE.SEND,
            user: 'pepper',
            text: '{{triggerEvent.device_name}}: {{triggerEvent.previous_value}} -> {{triggerEvent.last_value}}',
          },
        ],
      ],
      triggers: [trigger],
    });

  const newStateTrigger = {
    type: EVENTS.DEVICE.NEW_STATE,
    device_features: ['opening-kitchen', 'opening-living-room'],
    operator: '=',
    value: 1,
  };

  const newStateEvent = {
    type: EVENTS.DEVICE.NEW_STATE,
    device_feature: 'opening-kitchen',
    previous_value: 0,
    last_value: 1,
    last_value_changed: new Date('2026-09-26T10:00:00.000Z'),
  };

  beforeEach(() => {
    const house = {
      get: fake.resolves([]),
    };

    const scheduler = {
      scheduleJob: (date, callback) => {
        return {
          callback,
          date,
          cancel: () => {},
        };
      },
    };

    brain.addNamedEntity = fake.returns(null);
    brain.removeNamedEntity = fake.returns(null);
    message = { sendToUser: fake.resolves(null) };

    stateManager = new StateManager();
    stateManager.setState('deviceFeature', 'opening-kitchen', {
      selector: 'opening-kitchen',
      device_id: 'ba1a2b0f-c2d5-4b41-bbe7-a56f0a4a6c03',
      last_value: 1,
    });
    stateManager.setState('device', 'window-kitchen', {
      id: 'ba1a2b0f-c2d5-4b41-bbe7-a56f0a4a6c03',
      selector: 'window-kitchen',
      name: 'Fenêtre cuisine',
    });
    stateManager.setState('deviceById', 'ba1a2b0f-c2d5-4b41-bbe7-a56f0a4a6c03', {
      id: 'ba1a2b0f-c2d5-4b41-bbe7-a56f0a4a6c03',
      selector: 'window-kitchen',
      name: 'Fenêtre cuisine',
    });

    sceneManager = new SceneManager(
      stateManager,
      event,
      device,
      message,
      {},
      house,
      {},
      {},
      {},
      scheduler,
      brain,
      service,
    );
  });

  afterEach(() => {
    sinon.reset();
  });

  it('should put the name of the device which fired in the scope of the scene', async () => {
    const execute = sinon.spy(sceneManager, 'execute');
    await addScene(newStateTrigger);
    sceneManager.checkTrigger(newStateEvent);
    await waitForQueue();
    assert.calledOnce(execute);
    // the raw event is kept whole: a scene written before this variable existed
    // still reads {{triggerEvent.last_value}}
    expect(execute.firstCall.args[1].triggerEvent).to.deep.equal({
      ...newStateEvent,
      device_name: 'Fenêtre cuisine',
    });
    assert.calledOnce(message.sendToUser);
    expect(message.sendToUser.firstCall.args[1]).to.equal('Fenêtre cuisine: 0 -> 1');
  });

  it('should send a null device name when the feature is not in RAM', async () => {
    await addScene({ ...newStateTrigger, device_features: ['opening-unknown'] });
    sceneManager.checkTrigger({ ...newStateEvent, device_feature: 'opening-unknown' });
    await waitForQueue();
    assert.calledOnce(message.sendToUser);
    expect(message.sendToUser.firstCall.args[1]).to.equal(': 0 -> 1');
  });

  it('should send a null device name when the device of the feature is not in RAM', async () => {
    stateManager.setState('deviceFeature', 'opening-orphan', {
      selector: 'opening-orphan',
      device_id: 'e9b7b7f7-0000-0000-0000-000000000000',
    });
    await addScene({ ...newStateTrigger, device_features: ['opening-orphan'] });
    sceneManager.checkTrigger({ ...newStateEvent, device_feature: 'opening-orphan' });
    await waitForQueue();
    assert.calledOnce(message.sendToUser);
    expect(message.sendToUser.firstCall.args[1]).to.equal(': 0 -> 1');
  });

  it('should let a condition branch on the device which fired', async () => {
    await sceneManager.addScene({
      selector: 'gestion-des-ouvertures',
      active: true,
      actions: [
        [
          {
            type: ACTIONS.CONDITION.ONLY_CONTINUE_IF,
            conditions: [{ variable: 'triggerEvent.device_name', operator: '=', value: 'Fenêtre cuisine' }],
          },
        ],
        [
          {
            type: ACTIONS.MESSAGE.SEND,
            user: 'pepper',
            text: '{{triggerEvent.device_name}} est ouverte',
          },
        ],
      ],
      triggers: [newStateTrigger],
    });
    sceneManager.checkTrigger(newStateEvent);
    await waitForQueue();
    assert.calledOnce(message.sendToUser);
    expect(message.sendToUser.firstCall.args[1]).to.equal('Fenêtre cuisine est ouverte');
  });

  it('should stop the scene when the device which fired is not the one of the condition', async () => {
    stateManager.setState('deviceFeature', 'opening-living-room', {
      selector: 'opening-living-room',
      device_id: '7c4c5a1e-1111-4111-8111-111111111111',
    });
    stateManager.setState('deviceById', '7c4c5a1e-1111-4111-8111-111111111111', {
      id: '7c4c5a1e-1111-4111-8111-111111111111',
      selector: 'window-living-room',
      name: 'Fenêtre salon',
    });
    await sceneManager.addScene({
      selector: 'gestion-des-ouvertures',
      active: true,
      actions: [
        [
          {
            type: ACTIONS.CONDITION.ONLY_CONTINUE_IF,
            conditions: [{ variable: 'triggerEvent.device_name', operator: '=', value: 'Fenêtre cuisine' }],
          },
        ],
        [
          {
            type: ACTIONS.MESSAGE.SEND,
            user: 'pepper',
            text: '{{triggerEvent.device_name}} est ouverte',
          },
        ],
      ],
      triggers: [newStateTrigger],
    });
    sceneManager.checkTrigger({ ...newStateEvent, device_feature: 'opening-living-room' });
    await waitForQueue();
    assert.notCalled(message.sendToUser);
  });

  // What the device picker of the condition writes: the feature selector, which no rename
  // of the device can invalidate
  it('should let a condition branch on the selector of the feature which fired', async () => {
    const conditionOnSelector = (selector) => [
      [
        {
          type: ACTIONS.CONDITION.ONLY_CONTINUE_IF,
          conditions: [{ variable: 'triggerEvent.device_feature', operator: '=', value: selector }],
        },
      ],
      [
        {
          type: ACTIONS.MESSAGE.SEND,
          user: 'pepper',
          text: '{{triggerEvent.device_name}} est ouverte',
        },
      ],
    ];
    await sceneManager.addScene({
      selector: 'gestion-des-ouvertures',
      active: true,
      actions: conditionOnSelector('opening-kitchen'),
      triggers: [newStateTrigger],
    });
    await sceneManager.addScene({
      selector: 'gestion-des-ouvertures-autre',
      active: true,
      actions: conditionOnSelector('opening-living-room'),
      triggers: [newStateTrigger],
    });
    sceneManager.checkTrigger(newStateEvent);
    await waitForQueue();
    // only the scene whose condition names the feature which fired went through
    assert.calledOnce(message.sendToUser);
    expect(message.sendToUser.firstCall.args[1]).to.equal('Fenêtre cuisine est ouverte');
  });

  it('should not execute the scene when the trigger does not match', async () => {
    await addScene(newStateTrigger);
    sceneManager.checkTrigger({ ...newStateEvent, last_value: 0 });
    await waitForQueue();
    assert.notCalled(message.sendToUser);
  });
});
