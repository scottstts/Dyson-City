import type { frameLayout } from '../../src/city/dome/frame';

/**
 * Declared seats: a node's arms and cap sit in its own body; each arm's plate takes only that arm;
 * members sit in their plates and plinths; stiffeners are welded into their member; base plates sit
 * on their plinths round their member.
 */
export function domeClashAllow(layout: ReturnType<typeof frameLayout>): [string, string][] {
  const allow: [string, string][] = [
    ['splice:', 'member:'],
    ['stiffeners:', 'member:'],
    ['plinth:', 'member:'],
    ['footplate:', 'member:'],
    ['footplate:', 'plinth:'],
  ];
  for (const n of layout.nodes) {
    allow.push([`${n.name}:`, n.name]);
    n.arms.forEach((_, i) => allow.push([`${n.name}:arm${i}`, `splice:${n.name.slice(5)}:${i}`]));
  }
  return allow;
}
