import type { Point, Settings } from './types';
import { rotateAroundImageCenter } from './transform';
export function scaleToOutput(p:Point, sourceW:number, sourceH:number, s:Settings):Point {
  if (![p.x,p.y,sourceW,sourceH,s.outputWidth,s.outputHeight].every(Number.isFinite)||sourceW<=0||sourceH<=0||s.outputWidth<=0||s.outputHeight<=0) {
    throw new Error('Coordinate scaling requires finite, positive dimensions and coordinates.');
  }
  return {...p,x:p.x/sourceW*s.outputWidth,y:p.y/sourceH*s.outputHeight};
}
/** Physical scaling happens before this mapping; image rotation is applied once here. */
export function machinePoint(p:Point,s:Settings):Point {
  const rotated=rotateAroundImageCenter(p,s);
  let x=rotated.x,y=rotated.y;
  // Axis inversion is local to the physical image and therefore occurs around
  // its centre before changing the selected image-origin convention.
  if(s.invertX)x=s.outputWidth-x;
  if(s.invertY)y=s.outputHeight-y;
  if(s.origin==='center'){x-=s.outputWidth/2;y-=s.outputHeight/2}
  else if(s.origin==='top-left') y=s.outputHeight-y;
  return {...p,x:x+s.offsetX,y:y+s.offsetY};
}
export function distance(a:Point,b:Point){return Math.hypot(b.x-a.x,b.y-a.y,(b.z??0)-(a.z??0));}
export function simplify(points:Point[], tolerance:number): Point[]{
  if(!Number.isFinite(tolerance)||tolerance<0)throw new Error('Path simplification tolerance must be finite and non-negative.');
  if(points.some((point)=>!Number.isFinite(point.x)||!Number.isFinite(point.y)))throw new Error('Path simplification received a non-finite coordinate.');
  if(points.length<3)return points.slice();
  const retained=new Uint8Array(points.length);retained[0]=1;retained[points.length-1]=1;
  const segments:Array<[number,number]>=[[0,points.length-1]];
  while(segments.length){const[start,end]=segments.pop()!;const a=points[start],b=points[end];const lineLength=Math.hypot(b.x-a.x,b.y-a.y);let largestDistance=0,largestIndex=-1;for(let index=start+1;index<end;index+=1){const p=points[index];const pointDistance=lineLength?Math.abs((b.x-a.x)*(a.y-p.y)-(a.x-p.x)*(b.y-a.y))/lineLength:Math.hypot(p.x-a.x,p.y-a.y);if(pointDistance>largestDistance){largestDistance=pointDistance;largestIndex=index}}if(largestIndex!==-1&&largestDistance>tolerance){retained[largestIndex]=1;segments.push([start,largestIndex],[largestIndex,end])}}
  const result:Point[]=[];for(let index=0;index<points.length;index+=1)if(retained[index])result.push(points[index]);return result;
}
