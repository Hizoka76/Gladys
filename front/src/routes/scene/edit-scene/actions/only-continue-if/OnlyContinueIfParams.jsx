import { Component } from 'preact';
import { Text } from 'preact-i18n';
import { connect } from 'unistore/preact';
import update from 'immutability-helper';
import get from 'get-value';

import withIntlAsProp from '../../../../../utils/withIntlAsProp';

import { isVariableAvailableAtThisPath, convertPathToText } from '../../sceneUtils';

import Condition from './Condition';

class OnlyContinueIf extends Component {
  handleConditionChange = (conditionIndex, condition) => {
    const newConditions = update(this.props.action.conditions, {
      [conditionIndex]: {
        $set: condition
      }
    });
    this.props.updateActionProperty(this.props.path, 'conditions', newConditions);
  };

  addCondition = () => {
    const newConditions = update(this.props.action.conditions, {
      $push: [{}]
    });
    this.props.updateActionProperty(this.props.path, 'conditions', newConditions);
  };

  deleteCondition = conditionIndex => {
    const newConditions = update(this.props.action.conditions, {
      $splice: [[conditionIndex, 1]]
    });
    this.props.updateActionProperty(this.props.path, 'conditions', newConditions);
  };

  componentDidMount() {
    if (!this.props.action.conditions) {
      this.props.updateActionProperty(this.props.path, 'conditions', [{}]);
    }
  }

  // The variables of the triggers of the scene, listed first: they are the only ones
  // available before the first action has run. Several triggers all resolve to the single
  // trigger event that fired, so a variable declared by several of them is listed once.
  getTriggerVariableOptions = props => {
    const options = [];
    const seen = new Set();
    (props.triggersVariables || []).forEach(triggerVariables => {
      triggerVariables.forEach(triggerVariable => {
        if (seen.has(triggerVariable.name)) {
          return;
        }
        seen.add(triggerVariable.name);
        options.push({
          label: triggerVariable.label,
          value: `triggerEvent.${triggerVariable.name}`,
          type: triggerVariable.type,
          data: triggerVariable.data
        });
      });
    });
    if (options.length === 0) {
      return null;
    }
    return {
      label: get(this.props.intl.dictionary, 'editScene.actionsCard.onlyContinueIf.triggerVariablesGroup'),
      options
    };
  };

  render(props, {}) {
    const variableOptions = [];

    const triggerVariableOptions = this.getTriggerVariableOptions(props);
    if (triggerVariableOptions) {
      variableOptions.push(triggerVariableOptions);
    }

    Object.keys(props.variables).forEach(variablePath => {
      // If the variable is defined before the current path, we can use it
      if (isVariableAvailableAtThisPath(variablePath, props.path)) {
        const action = get(props.allActions, variablePath);
        // If we find an action at this path
        if (action) {
          variableOptions.push({
            label: `${convertPathToText(variablePath, this.props.intl.dictionary)} ${get(
              this,
              `props.intl.dictionary.editScene.actions.${action.type}`
            )}`,
            options: props.variables[variablePath].map(option => ({
              label: option.label,
              value: `${variablePath}.${option.name}`,
              type: option.type,
              data: option.data
            }))
          });
        }
      }
    });

    return (
      <div>
        <div class="alert alert-secondary">
          <div>
            <Text id="editScene.actionsCard.onlyContinueIf.logicExplanationText" />
          </div>
          <div class="mt-2">
            <Text id="editScene.actionsCard.onlyContinueIf.explanationText" />
          </div>
        </div>
        {props.action.conditions &&
          props.action.conditions.map((condition, index) => (
            <Condition
              condition={condition}
              index={index}
              variableOptions={variableOptions}
              handleConditionChange={this.handleConditionChange}
              addCondition={this.addCondition}
              deleteCondition={this.deleteCondition}
              lastOne={index + 1 === props.action.conditions.length}
              triggersVariables={props.triggersVariables}
              actionsGroupsBefore={props.actionsGroupsBefore}
              variables={props.variables}
              path={props.path}
              canDeleteCondition={props.action.conditions.length > 1}
            />
          ))}
      </div>
    );
  }
}

export default withIntlAsProp(connect('httpClient', {})(OnlyContinueIf));
