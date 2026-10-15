/**
 * A prefiltered environment captured at a point (a local reflection probe), looked up with parallax
 * correction instead of as if everything it saw were at infinity.
 *
 * Three's EnvironmentNode samples its env node inside a context that supplies the lookup direction
 * (the reflection vector, or the normal for irradiance) and the mip level (roughness). This node
 * reads that direction, traces it from the shaded point to the probe's proxy (a sphere of radius
 * `radius` about the capture point, closed below by the ground plane) and samples the capture
 * toward the hit: the pale ground mirrored in a gold flank sits on the ground, and a neighbour
 * seen in a tank sits roughly where the neighbour is.
 */
import { Node, type NodeBuilder, type Texture } from 'three/webgpu';
import { float, vec3, dot, sqrt, max, min, normalize, positionWorld, pmremTexture, select } from 'three/tsl';

type V3 = Node<'vec3'>;
type F = Node<'float'>;

interface EnvContext {
  getUV?: (node: Node, builder: NodeBuilder) => V3;
  getTextureLevel?: (node: Node) => F;
}

export interface ProbeProxy {
  /** Capture point (world). */
  centre: [number, number, number];
  /** Proxy sphere radius about the capture point. */
  radius: number;
  /** Ground plane height (the proxy is closed below by it). */
  groundY: number;
}

class ParallaxEnvironmentNode extends Node {
  static get type(): string {
    return 'ParallaxEnvironmentNode';
  }

  private readonly envTexture: Texture;
  private readonly proxy: ProbeProxy;

  constructor(envTexture: Texture, proxy: ProbeProxy) {
    super('vec3');
    this.envTexture = envTexture;
    this.proxy = proxy;
  }

  setup(builder: NodeBuilder): Node {
    const ctx = builder.context as EnvContext;
    const dir = normalize(ctx.getUV ? ctx.getUV(this, builder) : vec3(0, 1, 0));
    const level = ctx.getTextureLevel ? ctx.getTextureLevel(this) : float(0);
    const c = vec3(...this.proxy.centre);
    const o = positionWorld.sub(c);
    const b = dot(o, dir);
    const cc = dot(o, o).sub(this.proxy.radius * this.proxy.radius);
    // Exit from the sphere (the shaded point is inside it; if not, the far root still points outward).
    const tSphere = b.negate().add(sqrt(max(b.mul(b).sub(cc), 0)));
    const tGround = select(dir.y.lessThan(-1e-4), float(this.proxy.groundY).sub(positionWorld.y).div(dir.y), float(1e9));
    const t = max(min(tSphere, max(tGround, 0)), 0);
    const hit = o.add(dir.mul(t));
    return pmremTexture(this.envTexture, normalize(hit), level) as unknown as Node;
  }
}

/** An env node for `material.envNode` sampling a probe capture with parallax correction. */
export function parallaxEnvironment(envTexture: Texture, proxy: ProbeProxy): Node {
  return new ParallaxEnvironmentNode(envTexture, proxy);
}
