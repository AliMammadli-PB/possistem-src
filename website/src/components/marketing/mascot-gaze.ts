import * as THREE from 'three';

type Point = { x: number; y: number; z: number };
type Triangle = { a: Point; b: Point; c: Point; determinant: number };

/** Use the shipped iris geometry: no dependency on optional Blender metadata. */
export function createEyeGaze(eye: THREE.Object3D, pupil: THREE.Object3D) {
  eye.updateWorldMatrix(true, true);
  const toEye = eye.matrixWorld.clone().invert();
  const point = new THREE.Vector3();
  const triangles: Triangle[] = [], outline: Point[] = [];
  eye.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !/halo$/i.test(object.name)) return;
    const positions = object.geometry.getAttribute('position');
    const matrix = new THREE.Matrix4().multiplyMatrices(toEye, object.matrixWorld);
    const vertices: Point[] = [];
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(matrix);
      vertices.push({ x: point.x, y: point.y, z: point.z });
    }
    outline.push(...vertices);
    const indices = object.geometry.index;
    for (let i = 0, length = indices?.count ?? positions.count; i < length; i += 3) {
      const [a, b, c] = [0, 1, 2].map(j => vertices[indices ? indices.getX(i + j) : i + j]);
      const determinant = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      if (Math.abs(determinant) > 1e-12) triangles.push({ a, b, c, determinant });
    }
  });
  if (!triangles.length) return null;

  // Convex iris boundary and support planes limit the whole pupil AND glint.
  const sorted = outline.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Point, b: Point, c: Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const half = (points: Point[]) => {
    const hull: Point[] = [];
    for (const p of points) {
      while (hull.length > 1 && cross(hull[hull.length-2], hull[hull.length-1], p) <= 0) hull.pop();
      hull.push(p);
    }
    return hull.slice(0, -1);
  };
  const hull = [...half(sorted), ...half([...sorted].reverse())];
  const meshes: { mesh: THREE.Mesh; rest: Point[]; inverse: THREE.Matrix4; positions: THREE.BufferAttribute; clearance: number }[] = [];
  pupil.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.getAttribute('position');
    const matrix = new THREE.Matrix4().multiplyMatrices(toEye, object.matrixWorld);
    const rest: Point[] = [];
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(matrix);
      rest.push({ x: point.x, y: point.y, z: point.z });
    }
    // Meshopt can store normalized integer positions with a decode transform.
    // Replace the attribute, retaining that transform and a private geometry.
    object.geometry = object.geometry.clone();
    const writable = new THREE.Float32BufferAttribute(positions.count * 3, 3);
    object.geometry.setAttribute('position', writable);
    meshes.push({ mesh: object, rest, inverse: matrix.invert(), positions: writable,
      clearance: /reflection/i.test(object.name) ? .013 : .007 });
  });
  const constraints = hull.map((a, i) => {
    const b = hull[(i+1)%hull.length], length = Math.hypot(b.x-a.x, b.y-a.y);
    const nx = -(b.y-a.y)/length, ny = (b.x-a.x)/length;
    let available = Infinity;
    for (const {rest} of meshes) for (const p of rest) available = Math.min(available, nx*(p.x-a.x)+ny*(p.y-a.y));
    return { nx, ny, available: Math.max(0, available-.002) };
  });

  // Small spatial index avoids searching the entire iris for every vertex/frame.
  const minX = sorted[0].x, maxX = sorted[sorted.length-1].x;
  const minY = Math.min(...hull.map(p=>p.y)), maxY = Math.max(...hull.map(p=>p.y));
  const size = 12, cells: Triangle[][] = Array.from({length:size*size}, ()=>[]);
  const cell = (v:number, min:number, max:number) => Math.max(0,Math.min(size-1,Math.floor((v-min)/(max-min)*size)));
  for (const t of triangles) {
    const xs=[t.a.x,t.b.x,t.c.x], ys=[t.a.y,t.b.y,t.c.y];
    for(let y=cell(Math.min(...ys),minY,maxY);y<=cell(Math.max(...ys),minY,maxY);y++)
      for(let x=cell(Math.min(...xs),minX,maxX);x<=cell(Math.max(...xs),minX,maxX);x++) cells[y*size+x].push(t);
  }
  const surface = (x:number,y:number) => {
    for (const {a,b,c,determinant} of cells[cell(y,minY,maxY)*size+cell(x,minX,maxX)]) {
      const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/determinant;
      const v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/determinant;
      if(u>=-1e-5&&v>=-1e-5&&u+v<=1.00001)return u*a.z+v*b.z+(1-u-v)*c.z;
    }
    return null;
  };
  let previousX=NaN, previousY=NaN;
  return (x:number,y:number) => {
    let fraction=1;
    for(const {nx,ny,available} of constraints){const movement=nx*x+ny*y;if(movement<0)fraction=Math.min(fraction,available/-movement);}
    const dx=x*fraction,dy=y*fraction;
    if(Math.abs(dx-previousX)+Math.abs(dy-previousY)<.00002)return;
    previousX=dx;previousY=dy;
    for(const {mesh,rest,inverse,positions,clearance} of meshes){
      for(let i=0;i<rest.length;i++){
        const p=rest[i],ex=p.x+dx,ey=p.y+dy;
        point.set(ex,ey,(surface(ex,ey)??p.z)+clearance).applyMatrix4(inverse);
        positions.setXYZ(i,point.x,point.y,point.z);
      }
      positions.needsUpdate=true;mesh.geometry.computeBoundingSphere();
    }
  };
}
