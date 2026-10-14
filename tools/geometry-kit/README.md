# Geometry quality kit (vendored)

Audit half of the procedural-geometry skill's kit, copied unchanged: polygon topology
(`mesh-topology-audit.js`), world-space coplanar/clash audit of an `Object3D` hierarchy
(`geometry-audit.js`) and semantic contracts (`geometry-contract.js`). Used by `tests/` to gate every
procedural part. The modelling side lives in `src/geometry/` (a Y-up TypeScript kernel whose
`PolyMesh` matches the kit's MeshData layout).
