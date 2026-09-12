"""Imagegen-assisted CUBE v7 / X DESK v3. Blender 5.2, metres, reproducible exports.
Generated microdetail is an authorized reconstruction, not a measured product scan.
"""
import bpy, math, json, numpy as np
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
GEN=ROOT/'assets/material-library/realism-v1/generated'
REPORT=ROOT/'assets/material-library/realism-v1'


def read_pixels(path):
    im=bpy.data.images.load(str(path),check_existing=False)
    im.colorspace_settings.name='Non-Color'
    w,h=im.size
    a=np.array(im.pixels[:],dtype=np.float32).reshape(h,w,4)[:,:,:3].copy()
    bpy.data.images.remove(im)
    return a


def resize(a,w,h):
    ys=np.linspace(0,a.shape[0]-1,h);xs=np.linspace(0,a.shape[1]-1,w)
    yi=ys.astype(int);xi=xs.astype(int);fy=(ys-yi)[:,None,None];fx=(xs-xi)[None,:,None]
    return ((a[yi[:,None],xi]*(1-fx)+a[yi[:,None],np.minimum(xi+1,a.shape[1]-1)]*fx)*(1-fy)
        +(a[np.minimum(yi+1,a.shape[0]-1)[:,None],xi]*(1-fx)+a[np.minimum(yi+1,a.shape[0]-1)[:,None],np.minimum(xi+1,a.shape[1]-1)]*fx)*fy)


def save_map(path,a,color=False):
    path.parent.mkdir(parents=True,exist_ok=True)
    h,w,_=a.shape;im=bpy.data.images.new(path.stem,width=w,height=h,alpha=False)
    im.colorspace_settings.name='Non-Color'
    im.pixels.foreach_set(np.concatenate([np.clip(a,0,1),np.ones((h,w,1))],axis=2).astype(np.float32).ravel())
    im.filepath_raw=str(path);im.file_format='JPEG' if path.suffix=='.jpg' else 'PNG'
    bpy.context.scene.render.image_settings.quality=96
    im.save();bpy.data.images.remove(im)
    im=bpy.data.images.load(str(path),check_existing=False);im.colorspace_settings.name='sRGB' if color else 'Non-Color';im.pack()
    return im


def material(name,color,rough=.7):
    m=bpy.data.materials.new(name);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=rough
    bs.inputs['Specular IOR Level'].default_value=.3
    return m


def texture(m,image,socket,normal=False,strength=1):
    nt=m.node_tree;bs=nt.nodes.get('Principled BSDF')
    for l in list(bs.inputs[socket].links):nt.links.remove(l)
    t=nt.nodes.new('ShaderNodeTexImage');t.image=image;t.extension='REPEAT'
    if normal:
        n=nt.nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=strength
        nt.links.new(t.outputs['Color'],n.inputs['Color']);nt.links.new(n.outputs['Normal'],bs.inputs[socket])
    else:nt.links.new(t.outputs['Color'],bs.inputs[socket])


def normals(height,tile_m):
    step=tile_m/height.shape[0]
    dy=(np.roll(height,-1,axis=0)-np.roll(height,1,axis=0))/(2*step)
    dx=(np.roll(height,-1,axis=1)-np.roll(height,1,axis=1))/(2*step)
    n=np.stack([-dx,-dy,np.ones_like(height)],axis=2)
    n/=np.linalg.norm(n,axis=2,keepdims=True)
    return n*.5+.5


def prepare_cloth():
    a=read_pixels(GEN/'corduroy-reference.png')
    profile=a.mean(axis=(1,2));smooth=np.convolve(profile,np.ones(11)/11,mode='same')
    # Detect real generated repeat boundaries rather than assume prompt counts were obeyed.
    candidates=[i for i in range(15,len(smooth)-15) if smooth[i]==min(smooth[i-12:i+13])]
    candidates=[v for i,v in enumerate(candidates) if i==0 or v-candidates[i-1]>20]
    start,end=candidates[0],candidates[-1];count=len(candidates)-1
    assert 12<count<30,(count,candidates)
    a=resize(a[start:end],1024,1024)
    row=a.mean(axis=1,keepdims=True)
    # Remove most photographed lighting per wale; geometry/normal supplies moving highlights.
    target=np.array([.355,.306,.264])
    color=np.clip((a/np.maximum(row,.03))**.7*target,0,1)
    scalar=row.mean(axis=2)[:,0];smin,smax=np.percentile(scalar,[5,95])
    ridge=np.clip((scalar-smin)/(smax-smin),0,1)
    color*= (.67+.33*ridge[:,None,None])
    # A restrained 0.8 mm crown, plus generated microfibres, in physical metres.
    micro=(a/np.maximum(row,.03)).mean(axis=2)-1
    height=(ridge[:,None]**.55)*.0008+micro*.00008
    tile=count*.0100
    rough=np.repeat(np.clip(.82-micro*.16-(ridge[:,None]-.5)*.035,.69,.91)[:,:,None],3,axis=2)
    base=ROOT/'assets/cube-210030/textures'
    return (save_map(base/'v7-generated-cloth-color.jpg',color,True),
            save_map(base/'v7-generated-cloth-normal.png',normals(height,tile)),
            save_map(base/'v7-generated-cloth-roughness.png',rough),tile,
            {'detected_ribs':count,'source_crop_rows':[start,end],'rib_pitch_m':.010,'tile_m':tile,'relief_m':.0008})


def prepare_wood():
    a=resize(read_pixels(GEN/'oak-albedo.png'),1536,1536)
    # Neutral pale oak: retain generated grain and hue; reduce warm photographic cast.
    mean=a.mean(axis=(0,1));target=np.array([.70,.555,.395])
    a=np.clip(a/mean*target,0,1)
    gray=a.mean(axis=2);fine=gray-(np.roll(gray,4,0)+np.roll(gray,-4,0)+np.roll(gray,4,1)+np.roll(gray,-4,1))/4
    rough=np.repeat(np.clip(.64-fine*.55,.54,.73)[:,:,None],3,axis=2)
    base=ROOT/'assets/x-desk-210027/textures'
    return (save_map(base/'v3-generated-oak-color.jpg',a,True),
            save_map(base/'v3-generated-oak-roughness.png',resize(rough,1024,1024)),
            save_map(base/'v3-generated-oak-normal.png',normals(fine*.000018,.70)))


def curve_path(name,pts,radius,mat,tag,cyclic=True):
    curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.resolution_u=1
    curve.bevel_depth=radius;curve.bevel_resolution=1
    sp=curve.splines.new('POLY');sp.points.add(len(pts)-1)
    for p,co in zip(sp.points,pts):p.co=(*co,1)
    sp.use_cyclic_u=cyclic
    ob=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(ob);ob.data.materials.append(mat)
    bpy.context.view_layer.objects.active=ob;ob.select_set(True);bpy.ops.object.convert(target='MESH');ob=bpy.context.object;ob[tag]=True;ob.select_set(False)
    return ob


def rounded_loop(half,z,r=.016):
    pts=[]
    for cx,cy,start in [(half[0]-r,half[1]-r,0),(-half[0]+r,half[1]-r,90),(-half[0]+r,-half[1]+r,180),(half[0]-r,-half[1]+r,270)]:
        for i in range(13):
            a=math.radians(start+i*90/12);pts.append((cx+r*math.cos(a),cy+r*math.sin(a),z))
    return pts


def chair_model(cloth):
    base=ROOT/'assets/cube-210030'
    bpy.ops.wm.open_mainfile(filepath=str(base/'cube-blendkit.blend'))
    for ob in list(bpy.context.scene.objects):
        if ob.get('source'):bpy.data.objects.remove(ob,do_unlink=True)
    maps=[]
    for name,cs in [('v7-generated-cloth-color.jpg','sRGB'),('v7-generated-cloth-normal.png','Non-Color'),('v7-generated-cloth-roughness.png','Non-Color')]:
        im=bpy.data.images.load(str(base/'textures'/name));im.colorspace_settings.name=cs;im.pack();maps.append(im)
    mat=material('CUBE reconstructed brown ribbed velour',(.1,.07,.05),.82)
    texture(mat,maps[0],'Base Color');texture(mat,maps[1],'Normal',True);texture(mat,maps[2],'Roughness')
    seam=material('Brown sewn cover edge',(.052,.035,.024),.86)
    tile=cloth[3];objects=[]
    # A soft box whose face and edge shape is independent of the textile map.
    for name,loc,size in [('Lower cushion',(0,0,.116),(.8,.8,.232)),('Seat cushion',(0,0,.355),(.8,.8,.232)),('Backrest',(0,.266,.594),(.8,.268,.232))]:
        half=Vector(size)/2;rad=.024;core=half-Vector((rad,)*3)
        steps=30;verts=[];faces=[];uvs=[]
        for axis in range(3):
            ax=[i for i in range(3) if i!=axis]
            for sign in [-1,1]:
                start=len(verts)
                for j in range(steps+1):
                    for i in range(steps+1):
                        q=Vector((0,0,0));q[axis]=sign*half[axis]
                        q[ax[0]]=math.sin((i/steps-.5)*math.pi)*half[ax[0]];q[ax[1]]=math.sin((j/steps-.5)*math.pi)*half[ax[1]]
                        c=Vector(tuple(max(-core[k],min(core[k],q[k])) for k in range(3)))
                        p=c+(q-c).normalized()*rad
                        crown=(.0045 if axis==2 else .004)*math.sin(math.pi*i/steps)**2*math.sin(math.pi*j/steps)**2
                        # Keep the full extent within the measured outer box, with inset edges.
                        p[axis]+=sign*crown
                        if axis!=2:
                            # Sewn edge compression at the upper/lower cover join.
                            near=min(abs(q.z-(half.z-.015)),abs(q.z-(-half.z+.015)))
                            p[axis]-=sign*.0014*math.exp(-(near/.004)**2)*math.sin(math.pi*i/steps)**2*math.sin(math.pi*j/steps)**2
                        verts.append(tuple(p+Vector(loc)))
                        if axis==2:uv=(q.x/tile+.43,q.y/tile+.17)
                        elif axis==1:uv=(q.x/tile+.43,q.z/tile+.12)
                        else:uv=(q.y/tile+.17,q.z/tile+.12)
                        uvs.append(uv)
                for j in range(steps):
                    for i in range(steps):
                        a=start+j*(steps+1)+i;faces.append((a,a+1,a+steps+2,a+steps+1))
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();uv=mesh.uv_layers.new(name='Physical textile UV')
        for poly in mesh.polygons:
            for li in poly.loop_indices:uv.data[li].uv=uvs[mesh.loops[li].vertex_index]
        ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);mesh.materials.append(mat);ob['source']=True;objects.append(ob)
        bpy.context.view_layer.objects.active=ob;ob.select_set(True);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.remove_doubles(threshold=.00001);bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
        for p in mesh.polygons:p.use_smooth=True
        ob.select_set(False)
        for zz in [-half.z+.013,half.z-.013]:
            pts=[tuple(Vector(p)+Vector(loc)) for p in rounded_loop((half.x-.003,half.y-.003),zz,.024)]
            objects.append(curve_path(name+' sewn perimeter',pts,.00075,seam,'source'))
        # Four fine vertical corner joins: photographed seams, not decorative piping.
        for sx,sy in [(-1,-1),(1,-1),(-1,1),(1,1)]:
            pts=[(loc[0]+sx*(half.x-.007),loc[1]+sy*(half.y-.007),loc[2]+z) for z in np.linspace(-half.z+.016,half.z-.016,16)]
            # A closed line would duplicate this path; use a narrow seam segment box instead.
            ob=curve_path(name+' corner join',pts,.00065,seam,'source',False);objects.append(ob)
    normalize(objects,(.8,.8,.71))
    return objects


def screw_head(name,center,axis,mat):
    # Closed rounded head with genuine recessed hex socket, so side light reveals the rim.
    n=48;loops=[(.0045,0),(.0052,.0007),(.0050,.0017),(.0044,.0024),(.0021,.0024),(.0021,.0005)]
    verts=[];faces=[];rot=Vector(axis).to_track_quat('Z','Y').to_matrix()
    for k,(r,z) in enumerate(loops):
        for i in range(n):
            a=2*math.pi*i/n
            rr=r if k<4 else r*math.cos(math.pi/6)/math.cos((a%(math.pi/3))-math.pi/6)
            verts.append(tuple(Vector(center)+rot@Vector((rr*math.cos(a),rr*math.sin(a),z))))
    for k in range(len(loops)-1):
        for i in range(n):j=(i+1)%n;faces.append((k*n+i,k*n+j,(k+1)*n+j,(k+1)*n+i))
    faces.append(tuple(reversed(range(n))));faces.append(tuple((len(loops)-1)*n+i for i in range(n)))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);mesh.materials.append(mat);ob['product_part']=True
    for p in mesh.polygons:p.use_smooth=p.index<3*n
    return ob


def desk_model():
    base=ROOT/'assets/x-desk-210027';bpy.ops.wm.open_mainfile(filepath=str(base/'x-desk-blendkit.blend'))
    objects=[o for o in bpy.context.scene.objects if o.get('product_part')]
    wood=material('Reconstructed light oak furniture decor',(.4,.25,.12),.64)
    for name,cs,socket,isnormal in [('v3-generated-oak-color.jpg','sRGB','Base Color',False),('v3-generated-oak-roughness.png','Non-Color','Roughness',False),('v3-generated-oak-normal.png','Non-Color','Normal',True)]:
        im=bpy.data.images.load(str(base/'textures'/name));im.colorspace_settings.name=cs;im.pack();texture(wood,im,socket,isnormal)
    # Broad surfaces receive their own full map, avoiding the previous small atlas islands.
    for ob in objects:
        if not ob.name.startswith(('Oak desktop','Sloped oak')):continue
        old=ob.data.materials[0];ob.data.materials[0]=wood
        uv=ob.data.uv_layers.active
        for poly in ob.data.polygons:
            for li in poly.loop_indices:
                olduv=uv.data[li].uv.copy();u=(olduv.x*1024-2)/1020;row=(1-olduv.y)*1024
                if row<704:uv.data[li].uv=(u,(704-row)/704)
                elif row<992:uv.data[li].uv=(u*.86+.07,(992-row)/288*.24+.32)
                else:uv.data[li].uv=(u,(1024-row)/32*.021+.17)
    screwmat=material('Black steel rounded hex socket heads',(.024,.027,.030),.31);screwmat.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value=.7
    for ob in list(objects):
        if ' screw ' not in ob.name:continue
        coords=[v.co for v in ob.data.vertices];c=sum(coords,Vector())/len(coords);sx=1 if c.x>0 else -1;c.x-=sx*.001
        objects.remove(ob);bpy.data.objects.remove(ob,do_unlink=True)
        objects.append(screw_head('Recessed hex fixing '+str(tuple(c)),c,(sx,0,0),screwmat))
    normalize(objects,(.7,.48,.74))
    return objects


def normalize(objects,dimensions):
    coords=[o.matrix_world@v.co for o in objects for v in o.data.vertices]
    lo=Vector(tuple(min(v[i] for v in coords) for i in range(3)));hi=Vector(tuple(max(v[i] for v in coords) for i in range(3)))
    origin=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z));scale=Vector(tuple(dimensions[i]/(hi[i]-lo[i]) for i in range(3)))
    for ob in objects:
        for v in ob.data.vertices:v.co=Vector(tuple(((ob.matrix_world@v.co)[i]-origin[i])*scale[i] for i in range(3)))
        ob.matrix_world.identity()


def deliver(folder,stem,version,objects):
    base=ROOT/'assets'/folder;out=ROOT/'public/models'/folder
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:ob.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    # Triangulate ngons for predictable normal/tangent export.
    for ob in objects:
        if any(len(p.vertices)>4 for p in ob.data.polygons):
            mod=ob.modifiers.new('Export triangles','TRIANGULATE');bpy.context.view_layer.objects.active=ob;bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.export_scene.gltf(filepath=str(out/f'{stem}-{version}.glb'),export_format='GLB',use_selection=True,export_yup=True,export_tangents=True,export_animations=False,export_cameras=False,export_lights=False)
    bpy.ops.wm.usd_export(filepath=str(out/f'{stem}-{version}.usdz'),selected_objects_only=True,export_animation=False,export_lights=False,export_cameras=False,export_materials=True,generate_preview_surface=True,generate_materialx_network=False,export_textures_mode='NEW',overwrite_textures=True,relative_paths=True,root_prim_path='/Product',convert_orientation=True,export_global_forward_selection='NEGATIVE_Z',export_global_up_selection='Y',convert_scene_units='METERS',meters_per_unit=1,triangulate_meshes=True)
    s=bpy.context.scene;s.cycles.samples=48
    # Main camera follows the original front-right chair / front-left desk photo.
    s.camera.location=(1.45,-1.9,1.05) if stem=='cube' else (-1.3,-1.8,.94)
    target=Vector((0,0,.355 if stem=='cube' else .37));s.camera.rotation_euler=(target-s.camera.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.wm.save_as_mainfile(filepath=str(base/f'{stem}-realism.blend'))
    s.render.filepath=str(base/'renders'/f'{version}-realism-poster.png');bpy.ops.render.render(write_still=True)
    # Close-ups are actual new geometry/materials, not generated stand-in product renders.
    if stem=='cube':loc=(1.2,-1.2,.62);target=Vector((.30,-.30,.25));ortho=.34
    else:loc=(-.9,-1,.65);target=Vector((-.313,.06,.48));ortho=.23
    s.camera.location=loc;s.camera.rotation_euler=(target-s.camera.location).to_track_quat('-Z','Y').to_euler();s.camera.data.ortho_scale=ortho
    s.render.filepath=str(base/'renders'/f'{version}-realism-detail.png');bpy.ops.render.render(write_still=True)
    tris=sum(len(p.vertices)-2 for o in objects for p in o.data.polygons)
    assert tris<60000,tris
    return {'product':folder,'version':version,'triangles':tris,'source':str(base/f'{stem}-realism.blend'),'generated_microdetail':True,'hardware_socket_and_relief_depth':'inferred, not measured'}

bpy.ops.wm.read_factory_settings(use_empty=True)
cloth=prepare_cloth();prepare_wood()
reports=[]
reports.append(deliver('cube-210030','cube','v7',chair_model(cloth)))
reports.append(deliver('x-desk-210027','x-desk','v3',desk_model()))
(REPORT/'build-report.json').write_text(json.dumps({'cloth':cloth[4],'models':reports},indent=2)+'\n')
print('REALISM_COMPLETE',json.dumps(reports))
