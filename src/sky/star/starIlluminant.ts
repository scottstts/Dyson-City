/**
 * The star as an illuminant. The disc that is drawn (spots, faculae, granulation) is what lights the
 * world, so its mean radiance is measured once at boot on the GPU from the same shader that draws
 * it. Far structure, air, ground and glare all use the result, so they agree with the disc.
 *
 * The measure is the projected-disc average (uniform over the disc as seen, i.e. cosine-weighted
 * about the star's axis): exactly the irradiance-weighted mean for a surface facing the star.
 */
import { FloatType, NodeMaterial, QuadMesh, RenderTarget, Vector3, type WebGPURenderer } from 'three/webgpu';
import { Fn, vec3, vec4, dot, sqrt, max, screenUV, select } from 'three/tsl';
import { STAR_RADIUS_R } from '../../world/constants';
import { STAR_DISC_MEAN_RADIANCE } from '../../world/radiometry';
import { createStarSurface } from './starSurface';
import type { StarState } from './starState';

const SIZE = 512;

/** Measures the disc-mean radiance and stores it relative to the reference photosphere's in `star.illuminant`. */
export async function measureStarIlluminant(renderer: WebGPURenderer, star: StarState): Promise<Vector3> {
  const s = STAR_RADIUS_R;
  const surface = createStarSurface(star);
  const material = new NodeMaterial();
  material.name = 'StarIlluminant';
  material.colorNode = Fn(() => {
    const p = screenUV.mul(2).sub(1);
    const r2 = dot(p, p);
    const inside = r2.lessThan(1.0);
    // Direction whose sine from the star axis is |p|·sin α: uniform in p ⇒ projected-disc measure.
    const d = vec3(p.x.mul(s), sqrt(max(r2.mul(-s * s).add(1), 0.0)), p.y.mul(s)).toVar();
    const disc = max(d.y.mul(d.y).sub(1 - s * s), 0.0);
    const t = d.y.sub(sqrt(disc));
    const n = d.mul(t).sub(vec3(0, 1, 0)).div(s);
    const mu = dot(n, d.negate()).max(0.0);
    const col = surface(n, mu).rgb;
    return select(inside, vec4(col, 1.0), vec4(0.0));
  })();
  const target = new RenderTarget(SIZE, SIZE, { type: FloatType, depthBuffer: false });
  const quad = new QuadMesh(material);
  try {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    quad.render(renderer);
    renderer.setRenderTarget(previous);
    const px = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)) as Float32Array;
    const sum = [0, 0, 0];
    let count = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 0.5) continue;
      sum[0] += px[i];
      sum[1] += px[i + 1];
      sum[2] += px[i + 2];
      count++;
    }
    if (count === 0 || !sum.every(Number.isFinite)) throw new Error('Star illuminant measurement returned no finite samples');
    const ratio = new Vector3(...sum.map((v, i) => v / count / STAR_DISC_MEAN_RADIANCE[i]));
    (star.illuminant.value as Vector3).copy(ratio);
    return ratio;
  } finally {
    target.dispose();
    material.dispose();
  }
}
