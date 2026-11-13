// Keep the official device condition and trigger variables usable from the custom canvas.
describe('Scene canvas after the mobile editor merge', () => {
  it('Should offer device states and trigger variables, then save the graph on leaving', () => {
    const selector = `canvas-compatibility-${Date.now()}`;
    const device = {
      name: 'Merge thermometer',
      selector: 'merge-thermometer',
      features: [
        { name: 'Temperature', selector: 'merge-temperature', category: 'temperature-sensor', type: 'decimal' }
      ],
      service: { name: 'mqtt' }
    };
    cy.viewport(1280, 900);
    cy.login();
    cy.visit('/dashboard/scene');
    cy.window().then(win => {
      const user = JSON.parse(win.localStorage.getItem('user'));
      cy.request({
        method: 'POST',
        url: `${Cypress.env('serverUrl')}/api/v1/scene`,
        headers: { authorization: `Bearer ${user.access_token}` },
        body: {
          name: selector,
          selector,
          icon: 'activity',
          triggers: [{ type: 'device.new-state', device_feature: 'merge-temperature', operator: '>', value: 20 }],
          actions: [
            [
              {
                type: 'condition.only-continue-if',
                conditions: [{ device_feature: 'merge-temperature', operator: '>', value: 20 }]
              }
            ]
          ]
        }
      });
    });
    cy.intercept('GET', '**/api/v1/device*', [device]);
    cy.visit(`/dashboard/scene/${selector}`);
    cy.get(`button[aria-label="${Cypress.env('i18n').editScene.canvas.canvasViewTitle}"]`).click();
    cy.get('.react-flow__node-conditionNode').click();
    cy.get('[data-cy=scene-condition-device-or-variable] .react-select__control').click();
    cy.get('.react-select__menu').should('contain', 'Merge thermometer');
    cy.get('.react-select__menu').should(
      'contain',
      Cypress.env('i18n').editScene.variables.deviceTrigger.previousValue
    );
    cy.get('body').type('{esc}');
    cy.get(`textarea[placeholder="${Cypress.env('i18n').editScene.canvas.commentPlaceholder}"]`).type('Graph edit');
    cy.intercept('PATCH', `**/api/v1/scene/${selector}`).as('saveGraph');
    cy.get(`button[aria-label="${Cypress.env('i18n').editScene.backButton}"]`).click();
    cy.get('[data-cy=scene-leave-confirm]').should('be.visible');
    cy.get('[data-cy=scene-leave-save]').click();
    cy.wait('@saveGraph').then(({ request, response }) => {
      expect(response.statusCode).to.equal(200);
      expect(request.body.actions[0][0].comment).to.equal('Graph edit');
      expect(request.body.actions[0][0].conditions[0].device_feature).to.equal('merge-temperature');
    });
    cy.location('pathname').should('equal', '/dashboard/scene');
  });
});
