import { useState, useCallback, useMemo, useEffect, useRef } from 'preact/hooks';
import ReactFlow, {
  addEdge,
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Panel,
  MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';

import { Localizer, Text } from 'preact-i18n';
import { v4 as uuidv4 } from 'uuid';

import TriggerNode from './nodes/TriggerNode';
import ActionNode from './nodes/ActionNode';
import ConditionNode from './nodes/ConditionNode';
import {
  sceneToGraph,
  checkGraphIssues,
  NODE_TYPES,
  getActionLabel,
  getActionIcon,
  getTriggerLabel,
  getTriggerIcon,
  isConditionAction,
  isIfThenElse,
  isCalendarCondition
} from './sceneToGraph';
import { graphToScene } from './graphToScene';
import NodeSelector from './NodeSelector';
import NodeConfigPanel from './NodeConfigPanel';
import style from './canvasStyle.css';

const nodeTypes = {
  [NODE_TYPES.TRIGGER]: TriggerNode,
  [NODE_TYPES.ACTION]: ActionNode,
  [NODE_TYPES.CONDITION]: ConditionNode
};

const NODE_COLORS = {
  [NODE_TYPES.TRIGGER]: '#10b981',
  [NODE_TYPES.ACTION]: '#3b82f6',
  [NODE_TYPES.CONDITION]: '#f59e0b'
};

const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: false,
  markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
  style: { stroke: '#94a3b8', strokeWidth: 2 }
};

// Lit les positions de nœuds sauvegardées en localStorage pour une scène donnée.
// Retourne un objet vide si la clé est absente ou si le JSON est invalide.
function loadSavedPositions(key) {
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
}

// Pas de la grille d'aimantation, en pixels du canvas. Les constantes de layout
// de sceneToGraph sont calées dessus, pour que « Réorganiser » pose les blocs
// pile sur la grille au lieu de les décaler au premier déplacement.
const GRID_SIZE = 20;
// Ligne accentuée tous les 5 pas : garde un repère lisible une fois dézoomé,
// quand les lignes fines se resserrent.
const GRID_MAJOR_SIZE = GRID_SIZE * 5;

// Clé localStorage de la préférence d'aimantation. Volontairement globale, et
// non par scène comme les positions : c'est un réglage d'outil, pas une donnée
// de la scène.
const SNAP_KEY = 'gladys-canvas-snap';

// Lit la préférence d'aimantation, active par défaut — y compris quand le
// localStorage est inaccessible (navigation privée, stockage bloqué).
function loadSnapPreference() {
  try {
    return localStorage.getItem(SNAP_KEY) !== 'false';
  } catch {
    return true;
  }
}

const SceneCanvas = ({
  scene,
  saveScene,
  variables,
  triggersVariables,
  setVariables,
  setVariablesTrigger,
  registerApply,
  onDirtyChange
}) => {
  // Stable key per scene — used to persist node positions in localStorage
  const positionsKey = scene.selector ? `gladys-canvas-pos-${scene.selector}` : null;

  const initialGraph = useMemo(() => {
    const graph = sceneToGraph(scene);
    const saved = loadSavedPositions(positionsKey);
    if (Object.keys(saved).length > 0) {
      graph.nodes = graph.nodes.map(n => (saved[n.id] ? { ...n, position: saved[n.id] } : n));
    }
    return graph;
  }, []);

  const [nodes, setNodes, onNodesChangeBase] = useNodesState(initialGraph.nodes);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState(initialGraph.edges);

  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [graphWarnings, setGraphWarnings] = useState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [snapEnabled, setSnapEnabled] = useState(loadSnapPreference);
  // Verrouillage du graphe, équivalent du bouton « toggle interactivity » de
  // React Flow : celui d'origine pilote le store interne, celui-ci passe par les
  // propriétés de <ReactFlow>, ce qui permet de lui donner un libellé traduit.
  const [interactive, setInteractive] = useState(true);

  // Bascule l'aimantation et mémorise le choix pour les scènes suivantes.
  const toggleSnap = useCallback(() => {
    setSnapEnabled(enabled => {
      const next = !enabled;
      try {
        localStorage.setItem(SNAP_KEY, next ? 'true' : 'false');
      } catch {}
      return next;
    });
  }, []);

  const errorNodeIds = useMemo(() => {
    const ids = new Set();
    graphWarnings.forEach(w => (w.nodeIds || []).forEach(id => ids.add(id)));
    return ids;
  }, [graphWarnings]);

  const displayNodes = useMemo(
    () => nodes.map(n => ({ ...n, data: { ...n.data, hasError: errorNodeIds.has(n.id) } })),
    [nodes, errorNodeIds]
  );

  // Custom drag state
  const [draggingNode, setDraggingNode] = useState(null); // {nodeType, triggerType, actionType, label, icon}
  const [ghostPos, setGhostPos] = useState({ x: 0, y: 0 });
  const canvasRef = useRef(null);

  const selectedNode = nodes.find(n => n.id === selectedNodeId) || null;

  // ── Copier / coller (Ctrl+C / Ctrl+V) + sauvegarder (Ctrl+S) ────────
  const clipboardRef = useRef(null);
  // Refs stables pour éviter la stale closure dans le listener keydown enregistré une
  // seule fois au montage : les valeurs courantes sont toujours accessibles via .current.
  const selectedNodeIdRef = useRef(selectedNodeId);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const handleApplyRef = useRef(null); // mis à jour à chaque render (voir plus bas)
  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  // ── Historique Ctrl+Z / Ctrl+Y ────────────────────────────────────────
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const pushHistory = useCallback(() => {
    undoStackRef.current.push({
      nodes: JSON.parse(JSON.stringify(nodesRef.current)),
      edges: JSON.parse(JSON.stringify(edgesRef.current))
    });
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = [];
  }, []);

  // Wrappers onNodesChange / onEdgesChange : capture un snapshot avant toute
  // suppression déclenchée par la touche Delete sur des nœuds/arêtes sélectionnés.
  const onNodesChange = useCallback(
    changes => {
      if (changes.some(c => c.type === 'remove')) pushHistory();
      onNodesChangeBase(changes);
    },
    [onNodesChangeBase, pushHistory]
  );

  const onEdgesChange = useCallback(
    changes => {
      if (changes.some(c => c.type === 'remove')) pushHistory();
      onEdgesChangeBase(changes);
    },
    [onEdgesChangeBase, pushHistory]
  );

  // Capture un snapshot au début d'un drag pour annuler le déplacement.
  const onNodeDragStart = useCallback(() => {
    pushHistory();
  }, [pushHistory]);
  // ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = e => {
      // Don't intercept shortcuts when the user is typing in a form field
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (handleApplyRef.current) handleApplyRef.current();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (undoStackRef.current.length === 0) return;
        redoStackRef.current.push({
          nodes: JSON.parse(JSON.stringify(nodesRef.current)),
          edges: JSON.parse(JSON.stringify(edgesRef.current))
        });
        const snapshot = undoStackRef.current.pop();
        setNodes(snapshot.nodes);
        setEdges(snapshot.edges);
        setSelectedNodeId(null);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (redoStackRef.current.length === 0) return;
        undoStackRef.current.push({
          nodes: JSON.parse(JSON.stringify(nodesRef.current)),
          edges: JSON.parse(JSON.stringify(edgesRef.current))
        });
        const snapshot = redoStackRef.current.pop();
        setNodes(snapshot.nodes);
        setEdges(snapshot.edges);
        setSelectedNodeId(null);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        const selected = nodesRef.current.filter(n => n.selected);
        const srcNodes =
          selected.length > 0 ? selected : nodesRef.current.filter(n => n.id === selectedNodeIdRef.current);
        if (srcNodes.length === 0) return;
        const selectedIds = new Set(srcNodes.map(n => n.id));
        const srcEdges = edgesRef.current.filter(ed => selectedIds.has(ed.source) && selectedIds.has(ed.target));
        clipboardRef.current = { nodes: srcNodes, edges: srcEdges };
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && clipboardRef.current) {
        e.preventDefault();
        undoStackRef.current.push({
          nodes: JSON.parse(JSON.stringify(nodesRef.current)),
          edges: JSON.parse(JSON.stringify(edgesRef.current))
        });
        if (undoStackRef.current.length > 50) undoStackRef.current.shift();
        redoStackRef.current = [];
        const { nodes: srcNodes, edges: srcEdges } = clipboardRef.current;
        const idMap = {};
        const newNodes = srcNodes.map(src => {
          const id = `new-${uuidv4()}`;
          idMap[src.id] = id;
          return {
            ...src,
            id,
            selected: true,
            position: { x: src.position.x + 40, y: src.position.y + 40 },
            data: JSON.parse(JSON.stringify(src.data))
          };
        });
        const newEdges = srcEdges.map(ed => ({
          ...ed,
          id: `e-${uuidv4()}`,
          source: idMap[ed.source],
          target: idMap[ed.target]
        }));
        setNodes(nds => [...nds.map(n => ({ ...n, selected: false })), ...newNodes]);
        setEdges(eds => [...eds.map(e => ({ ...e, selected: false })), ...newEdges]);
        setSelectedNodeId(newNodes.length === 1 ? newNodes[0].id : null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setNodes, setEdges]);
  // ─────────────────────────────────────────────────────────────────────

  // ── Persistance des positions dans localStorage (debounce 600ms) ─────
  // Clé par scène (selector) : les positions survivent aux rechargements de page.
  // Le debounce évite une écriture localStorage à chaque pixel de déplacement.
  const saveTimerRef = useRef(null);
  useEffect(() => {
    if (!positionsKey) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const positions = {};
      nodes.forEach(n => {
        positions[n.id] = n.position;
      });
      try {
        localStorage.setItem(positionsKey, JSON.stringify(positions));
      } catch {}
    }, 600);
    return () => clearTimeout(saveTimerRef.current);
  }, [nodes, positionsKey]);
  // ─────────────────────────────────────────────────────────────────────

  // Synchronise la couleur des arêtes issues d'un nœud CALENDAR.IS_EVENT_RUNNING
  // quand stop_scene_if_event_found change dans le panneau de configuration.
  // Les arêtes sont un état séparé (useEdgesState) et ne se mettent pas à jour
  // automatiquement quand setNodes est appelé.
  useEffect(() => {
    setEdges(eds => {
      let changed = false;
      const newEds = eds.map(e => {
        const sourceNode = nodes.find(n => n.id === e.source);
        if (!sourceNode || !isCalendarCondition(sourceNode.data && sourceNode.data.action)) return e;
        const targetColor = sourceNode.data.action.stop_scene_if_event_found === true ? '#ef4444' : '#10b981';
        if (e.style && e.style.stroke === targetColor) return e;
        changed = true;
        return {
          ...e,
          style: { ...e.style, stroke: targetColor, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: targetColor }
        };
      });
      return changed ? newEds : eds;
    });
  }, [nodes]);

  // Coloration des arêtes lors d'une connexion manuelle (drag depuis un handle) :
  //  - handle 'then' → verte  (#10b981)
  //  - handle 'else' → rouge  (#ef4444)
  //  - CALENDAR.IS_EVENT_RUNNING → verte ou rouge selon stop_scene_if_event_found
  //  - condition simple (OnlyContinueIf, CheckTime…) → verte
  //  - action ordinaire → grise (défaut)
  const onConnect = useCallback(
    params => {
      let handleOverride = {};
      if (params.sourceHandle === 'then') {
        handleOverride = {
          style: { stroke: '#10b981', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' }
        };
      } else if (params.sourceHandle === 'else') {
        handleOverride = {
          style: { stroke: '#ef4444', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#ef4444' }
        };
      } else {
        const sourceNode = nodes.find(n => n.id === params.source);
        if (sourceNode && sourceNode.type === NODE_TYPES.CONDITION && !isIfThenElse(sourceNode.data.action)) {
          let condColor = '#10b981';
          if (isCalendarCondition(sourceNode.data.action)) {
            condColor = sourceNode.data.action.stop_scene_if_event_found === true ? '#ef4444' : '#10b981';
          }
          handleOverride = {
            style: { stroke: condColor, strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: condColor }
          };
        }
      }
      pushHistory();
      setEdges(eds =>
        addEdge(
          { ...params, ...defaultEdgeOptions, ...handleOverride },
          eds.map(e => ({ ...e, selected: false }))
        )
      );
      setNodes(nds => nds.map(n => ({ ...n, selected: false })));
      setSelectedNodeId(null);
    },
    [setEdges, setNodes, nodes, pushHistory]
  );

  // Ctrl/Meta/Shift + clic : désélectionne (ferme le panneau de config).
  // Clic simple : sélectionne le nœud et force la désélection de tous les autres
  // pour éviter qu'une multi-sélection antérieure ne reste active.
  const onNodeClick = useCallback(
    (e, node) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        setSelectedNodeId(null);
      } else {
        setSelectedNodeId(node.id);
        setNodes(nds => nds.map(n => (n.id === node.id ? n : { ...n, selected: false })));
      }
      setSelectorOpen(false);
    },
    [setNodes]
  );

  // Clic sur le fond du canvas : ferme le panneau de configuration.
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Callback React Flow déclenché quand la sélection change (drag-select, Ctrl+clic…).
  // Si plusieurs nœuds sont sélectionnés, on n'en désigne aucun comme "actif" pour
  // ne pas ouvrir le panneau sur un nœud arbitraire.
  const onSelectionChange = useCallback(({ nodes: sel }) => {
    if (sel.length > 1) setSelectedNodeId(null);
    else if (sel.length === 1) setSelectedNodeId(sel[0].id);
  }, []);

  // Supprime un nœud et toutes les arêtes qui lui sont connectées (source ou cible).
  const onDeleteNode = useCallback(
    nodeId => {
      pushHistory();
      setNodes(nds => nds.filter(n => n.id !== nodeId));
      setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
      setSelectedNodeId(null);
    },
    [setNodes, setEdges, pushHistory]
  );

  // Crée un nouveau nœud React Flow à la position donnée.
  // Pour les déclencheurs, le type React Flow est toujours TRIGGER.
  // Pour les actions, isConditionAction détermine si le type doit être CONDITION ou ACTION.
  const createNode = useCallback(
    ({ nodeType, actionType, triggerType }, position) => {
      pushHistory();
      const id = `new-${uuidv4()}`;
      if (nodeType === NODE_TYPES.TRIGGER) {
        const trigger = { type: triggerType };
        setNodes(nds => [
          ...nds,
          {
            id,
            type: NODE_TYPES.TRIGGER,
            position,
            data: { trigger, label: getTriggerLabel(trigger), icon: getTriggerIcon(trigger) }
          }
        ]);
      } else {
        const action = { type: actionType };
        setNodes(nds => [
          ...nds,
          {
            id,
            type: isConditionAction(action) ? NODE_TYPES.CONDITION : NODE_TYPES.ACTION,
            position,
            data: { action, label: getActionLabel(action), icon: getActionIcon(action) }
          }
        ]);
      }
    },
    [setNodes, pushHistory]
  );

  // Ajoute un nœud via un clic simple dans la palette (sans drag).
  // Positionné au centre visible du canvas, légèrement décalé selon le nombre
  // de nœuds existants pour éviter les superpositions.
  const onAddNode = useCallback(
    ({ type: nodeType, actionType, triggerType }) => {
      const center = reactFlowInstance
        ? reactFlowInstance.project({ x: 400, y: 200 + nodes.length * 40 })
        : { x: 400, y: 200 };
      createNode({ nodeType, actionType, triggerType }, center);
      setSelectorOpen(false);
    },
    [nodes, reactFlowInstance, createNode]
  );

  // ── Réorganisation automatique ────────────────────────────────────────
  // Reconvertit le graphe courant en scène (graphToScene), puis recalcule les
  // positions depuis zéro via sceneToGraph. Les positions sauvegardées en
  // localStorage sont effacées pour éviter qu'elles ne surchargent le nouveau layout.
  const handleAutoLayout = useCallback(() => {
    pushHistory();
    const currentScene = graphToScene(nodes, edges, scene);
    const freshGraph = sceneToGraph(currentScene);
    setNodes(freshGraph.nodes);
    setEdges(freshGraph.edges);
    if (positionsKey) {
      try {
        localStorage.removeItem(positionsKey);
      } catch {}
    }
  }, [nodes, edges, scene, setNodes, setEdges, positionsKey, pushHistory]);
  // ─────────────────────────────────────────────────────────────────────

  // ── Drag personnalisé depuis la palette NodeSelector ─────────────────
  // React Flow intercepte les événements pointeur sur le canvas ; on utilise
  // document-level pointermove/pointerup pour le ghost et la création du nœud,
  // indépendamment de React Flow.
  const dragStartPos = useRef(null);
  const hasMoved = useRef(false); // vrai si le curseur a bougé de plus de 4px

  // Déclenché par NodeSelector au pointerdown : initialise l'état du drag,
  // active le ghost et mémorise la position de départ pour détecter le mouvement.
  const onSelectorPointerDown = useCallback((nodeData, clientX, clientY) => {
    dragStartPos.current = { x: clientX, y: clientY };
    hasMoved.current = false;
    setDraggingNode(nodeData);
    setGhostPos({ x: clientX, y: clientY });
  }, []);

  // Getter stable exposé à NodeSelector pour qu'il sache si un vrai drag a eu lieu
  // et puisse ignorer le onClick suivant (évite la double création de nœud).
  const getDragMoved = useCallback(() => hasMoved.current, []);

  useEffect(() => {
    if (!draggingNode) return;

    const handleMove = e => {
      if (!hasMoved.current && dragStartPos.current) {
        const dx = e.clientX - dragStartPos.current.x;
        const dy = e.clientY - dragStartPos.current.y;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasMoved.current = true;
      }
      setGhostPos({ x: e.clientX, y: e.clientY });
    };

    const handleUp = e => {
      if (hasMoved.current && canvasRef.current && reactFlowInstance) {
        const rect = canvasRef.current.getBoundingClientRect();
        const inCanvas =
          e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
        if (inCanvas) {
          const position = reactFlowInstance.screenToFlowPosition({
            x: e.clientX,
            y: e.clientY
          });
          createNode(draggingNode, position);
          setSelectorOpen(false);
        }
      }
      setDraggingNode(null);
    };

    const handleKey = e => {
      if (e.key === 'Escape') setDraggingNode(null);
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
      document.removeEventListener('keydown', handleKey);
    };
  }, [draggingNode, reactFlowInstance, createNode]);
  // ────────────────────────────────────────────────────────────────────

  // ── Suivi des modifications non enregistrées ────────────────────────
  // Signature structurelle du graphe : identifiants, positions (graphToScene
  // ordonne les actions par position X, un déplacement change donc la scène) et
  // données des nœuds, plus les liens. La sélection d'un nœud, qui mute aussi
  // l'état React Flow, en est volontairement absente : cliquer sur un bloc ne
  // doit pas afficher « modifications non enregistrées ».
  const graphSignature = useMemo(
    () =>
      JSON.stringify({
        nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
        edges: edges.map(e => ({
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle
        }))
      }),
    [nodes, edges]
  );

  // Signature de la dernière version enregistrée, et dernier état signalé au
  // parent — pour n'appeler onDirtyChange qu'aux basculements, et pas à chaque
  // image d'un déplacement de bloc.
  const savedSignatureRef = useRef(graphSignature);
  const reportedDirtyRef = useRef(false);

  useEffect(() => {
    const dirty = graphSignature !== savedSignatureRef.current;
    if (dirty === reportedDirtyRef.current) return;
    reportedDirtyRef.current = dirty;
    if (onDirtyChange) onDirtyChange(dirty);
  }, [graphSignature, onDirtyChange]);

  // Convertit le graphe courant en scène Gladys et déclenche la sauvegarde API.
  // Utilise les refs (nodesRef, edgesRef) plutôt que les états directement pour
  // être sûr de travailler avec les valeurs les plus récentes depuis le listener keydown.
  const handleApply = useCallback(
    async (debug = false) => {
      const issues = checkGraphIssues(nodesRef.current, edgesRef.current);
      setGraphWarnings(issues);
      if (issues.some(w => w.blocking)) return false;
      const updatedScene = graphToScene(nodesRef.current, edgesRef.current, scene);
      // La signature est figée avant l'appel : le graphe peut bouger pendant que
      // la requête est en vol, et on ne doit alors pas afficher « enregistré ».
      const savedSignature = graphSignature;
      const saved = await saveScene(updatedScene, debug);
      if (saved === false) return false;
      savedSignatureRef.current = savedSignature;
      reportedDirtyRef.current = false;
      if (onDirtyChange) onDirtyChange(false);
      return true;
    },
    [scene, saveScene, graphSignature, onDirtyChange]
  );

  // Mise à jour du ref à chaque render : le listener keydown (enregistré une seule fois)
  // appelle toujours la version la plus récente de handleApply via ce ref.
  handleApplyRef.current = handleApply;

  // La barre d'actions du bas de page déclenche l'application du graphe : elle a
  // remplacé le bouton « Appliquer le graphe » qui vivait dans cette barre
  // d'outils, pour que les deux vues se sauvegardent au même endroit.
  useEffect(() => {
    if (!registerApply) return undefined;
    registerApply(handleApply);
    return () => registerApply(null);
  }, [registerApply, handleApply]);

  const miniMapNodeColor = node => {
    if (node.type === NODE_TYPES.TRIGGER) return '#10b981';
    if (node.type === NODE_TYPES.CONDITION) return '#f59e0b';
    return '#3b82f6';
  };

  return (
    <div class={`${style.sceneCanvasOuter} ${draggingNode ? style.isDragging : ''}`}>
      <div class={style.canvasWrapper} ref={canvasRef}>
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onSelectionChange={onSelectionChange}
          onNodeDragStart={onNodeDragStart}
          onInit={setReactFlowInstance}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          deleteKeyCode="Delete"
          multiSelectionKeyCode="Control"
          snapToGrid={snapEnabled}
          snapGrid={[GRID_SIZE, GRID_SIZE]}
          nodesDraggable={interactive}
          nodesConnectable={interactive}
          elementsSelectable={interactive}
        >
          {snapEnabled ? (
            <>
              <Background id="grid-minor" variant={BackgroundVariant.Lines} gap={GRID_SIZE} size={1} color="#eef2f7" />
              <Background
                id="grid-major"
                variant={BackgroundVariant.Lines}
                gap={GRID_MAJOR_SIZE}
                size={1}
                color="#e2e8f0"
              />
            </>
          ) : (
            <Background color="#e2e8f0" gap={24} size={1} />
          )}
          {/* Les boutons d'origine de React Flow portent des infobulles écrites en
              dur en anglais, sans propriété pour les remplacer : on les désactive
              et on fournit les nôtres dans le même conteneur. */}
          <Controls showZoom={false} showFitView={false} showInteractive={false}>
            <Localizer>
              <ControlButton
                onClick={() => reactFlowInstance && reactFlowInstance.zoomIn()}
                title={<Text id="editScene.canvas.zoomIn" />}
                aria-label={<Text id="editScene.canvas.zoomIn" />}
              >
                <i class="fe fe-plus" />
              </ControlButton>
            </Localizer>
            <Localizer>
              <ControlButton
                onClick={() => reactFlowInstance && reactFlowInstance.zoomOut()}
                title={<Text id="editScene.canvas.zoomOut" />}
                aria-label={<Text id="editScene.canvas.zoomOut" />}
              >
                <i class="fe fe-minus" />
              </ControlButton>
            </Localizer>
            <Localizer>
              <ControlButton
                onClick={() => reactFlowInstance && reactFlowInstance.fitView()}
                title={<Text id="editScene.canvas.fitView" />}
                aria-label={<Text id="editScene.canvas.fitView" />}
              >
                <i class="fe fe-maximize" />
              </ControlButton>
            </Localizer>
            <Localizer>
              <ControlButton
                onClick={() => setInteractive(v => !v)}
                title={<Text id={interactive ? 'editScene.canvas.lockGraph' : 'editScene.canvas.unlockGraph'} />}
                aria-label={<Text id={interactive ? 'editScene.canvas.lockGraph' : 'editScene.canvas.unlockGraph'} />}
              >
                <i
                  class={`fe ${interactive ? 'fe-unlock' : 'fe-lock'} ${
                    interactive ? style.controlUnlocked : style.controlLocked
                  }`}
                />
              </ControlButton>
            </Localizer>
          </Controls>
          <MiniMap nodeColor={miniMapNodeColor} pannable zoomable />

          <Panel position="top-left">
            <div class={style.panelToolbar}>
              <button
                class={`btn btn-sm btn-primary ${style.panelBtn}`}
                onClick={() => {
                  setSelectorOpen(v => !v);
                  setSelectedNodeId(null);
                }}
              >
                <i class="fe fe-plus mr-1" />
                <Text id="editScene.canvas.addBlock">Ajouter un bloc</Text>
              </button>
              <button class={`btn btn-sm btn-outline-secondary ${style.panelBtn}`} onClick={handleAutoLayout}>
                <i class="fe fe-shuffle mr-1" />
                <Text id="editScene.canvas.autoLayout">Réorganiser</Text>
              </button>
              <button
                class={`btn btn-sm ${snapEnabled ? 'btn-success' : 'btn-outline-secondary'} ${style.panelBtn}`}
                onClick={toggleSnap}
              >
                <i class="fe fe-grid mr-1" />
                <Text id="editScene.canvas.snapToGrid">Grille</Text>
              </button>
            </div>
          </Panel>

          {graphWarnings.length > 0 && (
            <Panel position="bottom-left">
              <div class={style.graphWarnings}>
                {graphWarnings.map((w, i) => (
                  <div
                    key={i}
                    class={`${style.graphWarning} ${
                      w.type === 'cycle' || w.type === 'incoherence' || w.type === 'convergence'
                        ? style.graphWarningDanger
                        : style.graphWarningInfo
                    }`}
                  >
                    <i
                      class={`fe ${
                        w.type === 'cycle'
                          ? 'fe-alert-triangle'
                          : w.type === 'incoherence'
                          ? 'fe-alert-octagon'
                          : w.type === 'convergence'
                          ? 'fe-git-merge'
                          : 'fe-copy'
                      } mr-2`}
                      style={{ flexShrink: 0 }}
                    />
                    <span>
                      {w.type === 'cycle' && <Text id="editScene.canvas.warningCycle" fields={{ label: w.label }} />}
                      {w.type === 'convergence' && (
                        <Text id="editScene.canvas.warningConvergence" fields={{ label: w.label }} />
                      )}
                      {w.type === 'duplication' && (
                        <Text id="editScene.canvas.warningDuplication" fields={{ label: w.label }} />
                      )}
                      {w.type === 'incoherence' && (
                        <Text id="editScene.canvas.warningIncoherence" fields={{ label: w.label }} />
                      )}
                    </span>
                    {!w.blocking && (
                      <button
                        class={style.graphWarningClose}
                        onClick={() => setGraphWarnings(ws => ws.filter((_, j) => j !== i))}
                      >
                        <i class="fe fe-x" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>

      {selectorOpen && (
        <>
          <div class={style.selectorOverlay} onClick={() => setSelectorOpen(false)} />
          <NodeSelector
            onAddNode={onAddNode}
            onSelectorPointerDown={onSelectorPointerDown}
            getDragMoved={getDragMoved}
            onClose={() => setSelectorOpen(false)}
          />
        </>
      )}

      {selectedNode && (
        <NodeConfigPanel
          selectedNode={selectedNode}
          setNodes={setNodes}
          scene={scene}
          variables={variables}
          triggersVariables={triggersVariables}
          setVariables={setVariables}
          setVariablesTrigger={setVariablesTrigger}
          onDelete={() => onDeleteNode(selectedNode.id)}
          onClose={() => setSelectedNodeId(null)}
        />
      )}

      {/* Drag ghost — follows the cursor, rendered outside any overflow container */}
      {draggingNode && (
        <div
          class={style.dragGhost}
          style={{
            transform: `translate(${ghostPos.x + 12}px, ${ghostPos.y + 12}px)`,
            borderColor: NODE_COLORS[draggingNode.nodeType] || '#3b82f6'
          }}
        >
          <i class={`fe ${draggingNode.icon}`} />
          <span>{draggingNode.label}</span>
        </div>
      )}
    </div>
  );
};

export default SceneCanvas;
