import update from 'immutability-helper';
import cx from 'classnames';
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';

import ActionGroup from './ActionGroup';
import SceneCanvas from './canvas/SceneCanvas';
import TriggerGroup from './TriggerGroup';
import style from './style.css';
import Settings from './Settings';
import EditActions from './EditActions';
import dashboardStyle from '../../dashboard/style.css';
import { Localizer, Text } from 'preact-i18n';

const EditScenePage = ({ children, ...props }) => {
  // The scene settings (name, description, icon, tags) are hidden by default
  // and open on demand from the header, to keep the scene visible right away
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = () => setSettingsOpen(true);
  const closeSettings = () => setSettingsOpen(false);

  // Inserting a step between two existing steps = inserting a new action group,
  // then adding an empty action (the type picker) inside it
  const insertStepAfter = async index => {
    await props.addActionGroupAfter(index);
    await props.addAction(`${index + 1}`);
  };

  return (
    <div class="page">
      {/* The scene editor lives on the same Horizon glass scene as the dashboard.
          It has no per-page appearance, so it takes the default scene directly
          instead of going through getBackgroundSceneClass */}
      {/* En vue graphique, ces trois niveaux prolongent la chaîne flex commencée
          par le thème (.page en colonne, .page-main en flex:1) jusqu'au canvas,
          qui occupe alors toute la place restante. Sans ces classes — donc en
          vue liste — la mise en page reste celle du reste de l'application. */}
      <div
        class={cx('page-main', 'glass-theme', dashboardStyle.dashboardBackground, dashboardStyle.glassScene, {
          [style.canvasModePage]: props.canvasView
        })}
      >
        {/* padding, not margin: a top margin collapses through the glass
            page-main and shifts the scene down */}
        <div class={cx('py-3', 'py-md-5', { [style.canvasModeSection]: props.canvasView })}>
          <div class={cx('container', style.pageContainer, { [style.canvasModeContainer]: props.canvasView })}>
            <div class="mb-4">
              <div class="row justify-content-between">
                <div class={cx('col', style.pageTitleColumn)}>
                  <h1 class={cx('page-title', style.pageTitle)}>
                    <Localizer>
                      <button
                        onClick={props.goBack}
                        class={cx('btn btn-secondary btn-sm', style.backButton)}
                        aria-label={<Text id="editScene.backButton" />}
                      >
                        <i class="fe fe-arrow-left" />
                      </button>
                    </Localizer>
                    {props.scene.icon && (
                      <span class={style.sceneIconTile}>
                        <i class={`fe fe-${props.scene.icon}`} />
                      </span>
                    )}
                    <span class={style.sceneName}>{props.scene.name}</span>

                    {/* The active flag is patched on its own: keep it from racing a full save */}
                    <label className="custom-switch m-0 ml-3 ml-md-4">
                      <input
                        type="checkbox"
                        name="active"
                        value="1"
                        className="custom-switch-input"
                        checked={props.scene.active}
                        onClick={props.switchActiveScene}
                        disabled={props.saving}
                      />
                      <span class="custom-switch-indicator" />
                    </label>
                  </h1>
                </div>

                <div class="col-auto">
                  <div class="text-right d-flex flex-wrap justify-content-end align-items-center">
                    <div class={cx(style.viewToggle, 'mr-3')}>
                      <button
                        type="button"
                        onClick={props.switchToListView}
                        class={cx(style.viewToggleBtn, { [style.viewToggleBtnActive]: !props.canvasView })}
                      >
                        <i class="fe fe-list" />
                        <Text id="editScene.canvas.listViewTitle" />
                      </button>
                      <button
                        type="button"
                        onClick={props.switchToCanvasView}
                        class={cx(style.viewToggleBtn, { [style.viewToggleBtnActive]: props.canvasView })}
                      >
                        <i class="fe fe-share-2" />
                        <Text id="editScene.canvas.canvasViewTitle" />
                      </button>
                    </div>
                    <Localizer>
                      <button
                        onClick={settingsOpen ? closeSettings : openSettings}
                        data-cy="edit-scene-settings-button"
                        aria-label={<Text id="editScene.settings" />}
                        className={cx('btn mb-0', style.headerActionBtn, {
                          'btn-secondary': settingsOpen,
                          'btn-outline-secondary': !settingsOpen
                        })}
                      >
                        <span class="d-none d-md-inline-block" aria-hidden="true">
                          <Text id="editScene.settings" />
                        </span>{' '}
                        <i class="fe fe-settings" />
                      </button>
                    </Localizer>
                  </div>
                </div>
                <div class="col-12 text-muted">{props.scene.description && <span>{props.scene.description}</span>}</div>
              </div>
            </div>
            {/* Ce conteneur porte les alertes, le panneau de configuration et la
                vue elle-même : il fait partie de la chaîne flex, sans quoi la
                ligne du canvas ne pourrait pas grandir. */}
            <div class={cx({ [style.canvasModeSection]: props.canvasView })}>
              {props.error && (
                <div class="alert alert-danger">
                  <Text id="editScene.saveSceneError" />
                  {props.errorMessage && (
                    <div class="mt-2">
                      <small>{props.errorMessage}</small>
                    </div>
                  )}
                </div>
              )}
              {settingsOpen && (
                <div class="row">
                  <Settings
                    scene={props.scene}
                    updateSceneName={props.updateSceneName}
                    updateSceneDescription={props.updateSceneDescription}
                    updateSceneIcon={props.updateSceneIcon}
                    setTags={props.setTags}
                    tags={props.tags}
                    saving={props.saving}
                    closeSettings={closeSettings}
                  />
                </div>
              )}

              {props.canvasView && (
                <div class={cx('row', style.canvasModeRow)}>
                  <div class={cx('col-12', style.canvasModeCol)}>
                    <SceneCanvas
                      scene={props.scene}
                      saveScene={props.saveSceneFromCanvas}
                      saving={props.saving}
                      variables={props.variables}
                      triggersVariables={props.triggersVariables}
                      setVariables={props.setVariables}
                      setVariablesTrigger={props.setVariablesTrigger}
                    />
                  </div>
                </div>
              )}

              {!props.canvasView && (
                <Fragment>
                  <div class="row">
                    <div class="col-lg-12">
                      <div class={style.sectionHeader}>
                        <span class={cx(style.sectionTitle, style.sectionTitleWhen)}>
                          <Text id="editScene.whenSectionTitle" />
                        </span>
                        <span class={style.sectionSubtitle}>
                          <Text id="editScene.whenSectionSubtitle" />
                        </span>
                      </div>
                    </div>
                  </div>
                  <div class="row">
                    <TriggerGroup
                      triggers={props.scene.triggers}
                      addTrigger={props.addTrigger}
                      deleteTrigger={props.deleteTrigger}
                      updateTriggerProperty={props.updateTriggerProperty}
                      saving={props.saving}
                      variables={props.variables}
                      setVariablesTrigger={props.setVariablesTrigger}
                    />
                  </div>
                  <div class="row">
                    <div class="col-lg-12">
                      <div class={style.sectionHeader}>
                        <span class={cx(style.sectionTitle, style.sectionTitleThen)}>
                          <Text id="editScene.thenSectionTitle" />
                        </span>
                        <span class={style.sectionSubtitle}>
                          <Text id="editScene.thenSectionSubtitle" />
                        </span>
                      </div>
                    </div>
                  </div>
                </Fragment>
              )}
            </div>

            {!props.canvasView && (
              <Fragment>
                {/* The root step flow: the droppable surface of the whole "then"
                sequence (stepDrag.js computes the insertion point inside it) */}
                <div data-step-flow data-flow-path="" data-flow-level="1">
                  {props.scene.actions.map((parallelActions, index) => (
                    <div>
                      <div class="row">
                        <ActionGroup
                          moveCard={props.moveCard}
                          moveCardGroup={props.moveCardGroup}
                          addAction={props.addAction}
                          deleteActionGroup={props.deleteActionGroup}
                          actions={parallelActions}
                          allActions={props.scene.actions}
                          deleteAction={props.deleteAction}
                          updateSelectedNewAction={props.updateSelectedNewAction}
                          updateActionProperty={props.updateActionProperty}
                          highLightedActions={props.highLightedActions}
                          sceneParamsData={props.sceneParamsData}
                          scene={props.scene}
                          index={index}
                          path={`${index}`}
                          saving={props.saving}
                          actionsGroupsBefore={update(props.scene.actions, {
                            $splice: [[index, props.scene.actions.length - index]]
                          })}
                          lastActionGroup={index === props.scene.actions.length - 1}
                          variables={props.variables}
                          triggersVariables={props.triggersVariables}
                          setVariables={props.setVariables}
                        />
                      </div>

                      {parallelActions.length > 0 &&
                        index + 1 < props.scene.actions.length &&
                        props.scene.actions[index + 1].length > 0 && (
                          <div class={style.stepConnector}>
                            <Localizer>
                              <button
                                onClick={() => insertStepAfter(index)}
                                class={style.stepInsertButton}
                                disabled={props.saving}
                                aria-label={<Text id="editScene.insertStepButton" />}
                              >
                                <i class="fe fe-plus" />
                              </button>
                            </Localizer>
                          </div>
                        )}
                    </div>
                  ))}
                </div>
                <EditActions {...props} />
              </Fragment>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditScenePage;
