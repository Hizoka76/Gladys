import { useMemo } from 'preact/hooks';
import { BaseEdge, getBezierPath } from 'reactflow';

// Nommé css et non style : la propriété `style` de l'arête porte déjà son trait
import css from './canvasStyle.css';

// Pointe dessinée à l'origine, orientée vers la droite : la rotation appliquée
// ensuite l'aligne sur la tangente du tracé.
const ARROW_PATH = 'M -5 -4.5 L 5 0 L -5 4.5 Z';

// Distance, en pixels de longueur d'arc, entre chaque extrémité et la pointe qui
// la suit ou la précède.
const END_OFFSET = 10;

// Écart entre les deux points échantillonnés de part et d'autre d'une pointe
// pour estimer la direction du tracé à cet endroit.
const TANGENT_SAMPLE = 2;

// En deçà de cet espacement, deux pointes se chevaucheraient : sur une arête
// courte, seules celles qui tiennent sont dessinées.
const MIN_SPACING = 14;

const DEFAULT_COLOR = '#94a3b8';

/**
 * Arête portant ses pointes le long du tracé plutôt qu'à son extrémité.
 *
 * React Flow ne sait poser ses marqueurs qu'au bout : sur une courbe de Bézier,
 * la flèche arrive à plat contre le bloc cible et se lit mal. Celles-ci sont
 * réparties sur le trajet — après le départ, au milieu, avant l'arrivée — et
 * orientées chacune selon la tangente locale.
 *
 * Les angles sont mesurés sur un élément <path> détaché, jamais inséré dans le
 * document : c'est le seul moyen exact, la tangente au milieu d'une Bézier
 * s'écartant d'une quinzaine de degrés de la corde source→cible sur les
 * branches obliques. Si la mesure échoue (environnement sans mise en page), on
 * retombe sur une pointe unique au centre, orientée selon cette corde.
 */
const MidArrowEdge = ({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  style = {},
  markerEnd, // volontairement non transmis : ces pointes le remplacent
  markerStart,
  ...rest
}) => {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });

  const arrows = useMemo(() => {
    const chord = (Math.atan2(targetY - sourceY, targetX - sourceX) * 180) / Math.PI;
    try {
      const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      probe.setAttribute('d', path);
      const length = probe.getTotalLength();
      if (!length) {
        return [{ x: labelX, y: labelY, angle: chord }];
      }

      const kept = [];
      [END_OFFSET, length / 2, length - END_OFFSET].forEach(distance => {
        if (distance < 0 || distance > length) {
          return;
        }
        if (kept.length > 0 && distance - kept[kept.length - 1] < MIN_SPACING) {
          return;
        }
        kept.push(distance);
      });

      return kept.map(distance => {
        const point = probe.getPointAtLength(distance);
        const before = probe.getPointAtLength(Math.max(0, distance - TANGENT_SAMPLE));
        const after = probe.getPointAtLength(Math.min(length, distance + TANGENT_SAMPLE));
        return {
          x: point.x,
          y: point.y,
          angle: (Math.atan2(after.y - before.y, after.x - before.x) * 180) / Math.PI
        };
      });
    } catch {
      return [{ x: labelX, y: labelY, angle: chord }];
    }
  }, [path, labelX, labelY, sourceX, sourceY, targetX, targetY]);

  const color = style.stroke || DEFAULT_COLOR;

  return (
    <>
      <BaseEdge {...rest} path={path} style={style} />
      {arrows.map((arrow, index) => (
        <path
          key={index}
          d={ARROW_PATH}
          fill={color}
          transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle})`}
          class={css.edgeArrow}
        />
      ))}
    </>
  );
};

export default MidArrowEdge;
