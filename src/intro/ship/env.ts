/**
 * What the ship reflects and is lit by (docs/intro-ship.md, "Light"). Like every vehicle it is lit
 * only by image-based light, from wherever it is:
 *
 *  - on the band (scenes 2 and 3): the open sky's capture, the star overhead in it;
 *  - in deep space (scene 1): a capture of the sphere seen from outside, the star blazing through
 *    its openings (space/capture.ts).
 *
 * Both are prefiltered environments; a uniform picks one (both are read, on the ship's pixels only).
 * Three's EnvironmentNode samples an env node inside a context that supplies the lookup direction
 * and the mip level (render/parallaxEnv.ts); this node reads that context.
 */
import { Node, type NodeBuilder, type Texture } from 'three/webgpu';
import { float, vec3, normalize, pmremTexture, select, uniform } from 'three/tsl';

type V3 = Node<'vec3'>;
type F = Node<'float'>;

interface EnvContext {
  getUV?: (node: Node, builder: NodeBuilder) => V3;
  getTextureLevel?: (node: Node) => F;
}

/** Which environment the ship is in: 1 deep space, 0 the band. */
export const shipInSpace = uniform(0);

class ShipEnvironmentNode extends Node {
  static get type(): string {
    return 'ShipEnvironmentNode';
  }

  private readonly band: Texture;
  private readonly space: Texture;

  constructor(band: Texture, space: Texture) {
    super('vec3');
    this.band = band;
    this.space = space;
  }

  setup(builder: NodeBuilder): Node {
    const ctx = builder.context as EnvContext;
    const dir = normalize(ctx.getUV ? ctx.getUV(this, builder) : vec3(0, 1, 0));
    const level = ctx.getTextureLevel ? ctx.getTextureLevel(this) : float(0);
    const onBand = pmremTexture(this.band, dir, level) as unknown as V3;
    const inSpace = pmremTexture(this.space, dir, level) as unknown as V3;
    return select(shipInSpace.greaterThan(0.5), inSpace, onBand) as unknown as Node;
  }
}

/** An env node for the ship's materials: the band's capture, or deep space's. */
export function shipEnvironment(band: Texture, space: Texture): Node {
  return new ShipEnvironmentNode(band, space);
}
