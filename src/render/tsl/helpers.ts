/**
 * Small typed wrappers over TSL APIs whose published typings are too loose or too strict for
 * shader code written here. They add no runtime behaviour.
 */
import { Loop, int, uniformArray } from 'three/tsl';
import type { Node, Vector4 } from 'three/webgpu';

/**
 * A counted loop with an explicit, unique index name. Nested TSL loops otherwise all name their
 * index `i`, and lazily emitted expressions can then bind to the wrong (shadowing) variable.
 */
export function loop(name: string, count: number | Node<'int'>, body: (i: Node<'int'>) => void): void {
  const params = { start: int(0), end: typeof count === 'number' ? int(count) : count, type: 'int', condition: '<', name };
  (Loop as unknown as (p: object, f: (inputs: Record<string, Node<'int'>>) => void) => void)(params, (inputs) => body(inputs[name]));
}

export interface Vec4Array {
  readonly node: ReturnType<typeof uniformArray>;
  readonly values: Vector4[];
  at(i: Node<'int'> | number): Node<'vec4'>;
}

export function vec4Array(values: Vector4[]): Vec4Array {
  const node = uniformArray(values, 'vec4');
  return {
    node,
    values,
    at: (i) => (node as unknown as { element: (i: Node<'int'>) => Node<'vec4'> }).element(typeof i === 'number' ? int(i) : i),
  };
}
