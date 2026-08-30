import { useState } from 'preact/hooks';
import { Text } from 'preact-i18n';

import TypePicker from '../TypePicker';
import { ACTION_CATEGORIES, ACTION_ICON, DEPRECATED_ACTIONS, TRIGGER_CATEGORIES, TRIGGER_ICON } from '../typesCatalog';
import {
  NODE_TYPES,
  isConditionAction,
  getActionLabel,
  getActionIcon,
  getTriggerLabel,
  getTriggerIcon
} from './sceneToGraph';
import style from './canvasStyle.css';

// Le catalogue partagé avec la vue liste range les conditions dans une catégorie
// dédiée : on l'extrait pour lui conserver son onglet, les deux autres onglets
// se partageant le reste.
const CONDITION_CATEGORY_KEY = 'conditions';
const ACTION_ONLY_CATEGORIES = ACTION_CATEGORIES.filter(c => c.key !== CONDITION_CATEGORY_KEY);
const CONDITION_CATEGORIES = ACTION_CATEGORIES.filter(c => c.key === CONDITION_CATEGORY_KEY);

const TABS = [
  { id: 'trigger', labelId: 'editScene.canvas.tabTriggers' },
  { id: 'action', labelId: 'editScene.canvas.tabActions' },
  { id: 'condition', labelId: 'editScene.canvas.tabConditions' }
];

const TAB_CLASS = {
  trigger: style.selectorTabTrigger,
  action: style.selectorTabAction,
  condition: style.selectorTabCondition
};

/**
 * Panneau de sélection des blocs (déclencheurs, actions, conditions).
 *
 * Le contenu de chaque onglet vient de TypePicker, le composant qu'utilisent
 * déjà les cartes « Nouveau déclencheur » et « Nouvelle action » de la vue
 * liste : mêmes intitulés traduits, mêmes descriptions, même recherche, même
 * classement par catégorie. La palette n'a donc plus sa propre liste de blocs à
 * tenir à jour — un type ajouté au catalogue y apparaît sans rien toucher ici.
 *
 * Deux modes d'ajout, comme avant :
 *  - Clic simple → onAddNode (bloc centré sur le canvas)
 *  - Glisser-déposer → onSelectorPointerDown démarre le fantôme, SceneCanvas
 *    crée le nœud à l'endroit du relâchement via createNode()
 */
const NodeSelector = ({ onAddNode, onSelectorPointerDown, getDragMoved, onClose }) => {
  const [activeTab, setActiveTab] = useState('trigger');
  const isTrigger = activeTab === 'trigger';

  const handleSelect = type => {
    onAddNode(
      isTrigger ? { type: NODE_TYPES.TRIGGER, triggerType: type } : { type: NODE_TYPES.ACTION, actionType: type }
    );
  };

  // Données du fantôme qui suit le curseur pendant le glissé. Le type de nœud
  // est déduit comme le fait createNode : une action de condition donne un nœud
  // condition, quel que soit l'onglet d'où elle a été prise.
  const handlePointerDown = (type, clientX, clientY) => {
    const nodeData = isTrigger
      ? {
          nodeType: NODE_TYPES.TRIGGER,
          triggerType: type,
          label: getTriggerLabel({ type }),
          icon: getTriggerIcon({ type })
        }
      : {
          nodeType: isConditionAction({ type }) ? NODE_TYPES.CONDITION : NODE_TYPES.ACTION,
          actionType: type,
          label: getActionLabel({ type }),
          icon: getActionIcon({ type })
        };
    onSelectorPointerDown(nodeData, clientX, clientY);
  };

  return (
    <div class={style.selectorPanel}>
      <div class={style.selectorHeader}>
        <span class={style.selectorTitle}>
          <Text id="editScene.canvas.addBlock">Ajouter un bloc</Text>
        </span>
        <button class={style.selectorClose} onClick={onClose}>
          <i class="fe fe-x" />
        </button>
      </div>

      <div class={style.selectorTabs}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            class={`${style.selectorTab} ${
              activeTab === tab.id ? `${style.selectorTabActive} ${TAB_CLASS[tab.id]}` : ''
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <Text id={tab.labelId} />
          </button>
        ))}
      </div>

      {/* La clé force un TypePicker neuf à chaque onglet : sa recherche est un
          état interne, qu'il ne faut pas traîner d'un onglet à l'autre. */}
      <div class={style.selectorList}>
        {isTrigger ? (
          <TypePicker
            key="trigger"
            categories={TRIGGER_CATEGORIES}
            icons={TRIGGER_ICON}
            labelPrefix="editScene.triggers"
            descriptionPrefix="editScene.triggersDescriptions"
            categoryPrefix="editScene.triggerCategories"
            searchPlaceholderId="editScene.searchTriggersPlaceholder"
            onSelect={handleSelect}
            onOptionPointerDown={handlePointerDown}
            wasDragged={getDragMoved}
          />
        ) : (
          <TypePicker
            key={activeTab}
            categories={activeTab === 'condition' ? CONDITION_CATEGORIES : ACTION_ONLY_CATEGORIES}
            icons={ACTION_ICON}
            deprecated={DEPRECATED_ACTIONS}
            labelPrefix="editScene.actions"
            descriptionPrefix="editScene.actionsDescriptions"
            categoryPrefix="editScene.actionCategories"
            searchPlaceholderId="editScene.searchActionsPlaceholder"
            onSelect={handleSelect}
            onOptionPointerDown={handlePointerDown}
            wasDragged={getDragMoved}
          />
        )}
      </div>
    </div>
  );
};

export default NodeSelector;
