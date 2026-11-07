# Optional geometry review only. Requires Blender, not a Talkthrough dependency.
# blender -b -t 2 --python scripts/components/render-hinged-panels.py -- meshes-dir gallery.png [detail|comparison]
import bpy
import json
import math
import os
import sys
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
folder, output = args[:2]
detail = len(args) > 2 and args[2] == 'detail'
comparison = len(args) > 2 and args[2] == 'comparison'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

forward = Vector((-7, -5, -12)).normalized()
right = forward.cross(Vector((0, 1, 0))).normalized()
up = right.cross(forward).normalized()
rotation = Matrix((right, up, -forward)).transposed().to_quaternion()
comparison_groups = []

def text(body, x, y, size, color=(0.84, 0.89, 0.97, 1)):
    curve = bpy.data.curves.new(body, 'FONT')
    curve.body = body
    curve.align_x = 'CENTER'
    curve.size = size
    obj = bpy.data.objects.new(body, curve)
    bpy.context.collection.objects.link(obj)
    obj.location = right * x + up * y - forward * 5
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = rotation
    mat = bpy.data.materials.new('label')
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    emission = nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value = color
    material_output = nodes.new('ShaderNodeOutputMaterial')
    mat.node_tree.links.new(emission.outputs[0], material_output.inputs['Surface'])
    obj.data.materials.append(mat)

def add_model(name, offset, scale_to=None, fit=None):
    with open(os.path.join(folder, name + '.json')) as source:
        data = json.load(source)
    meshes = data['meshes']
    all_vertices = [Vector(v) for p in meshes for v in p['vertices']]
    low = Vector(tuple(min(v[k] for v in all_vertices) for k in range(3)))
    high = Vector(tuple(max(v[k] for v in all_vertices) for k in range(3)))
    if fit is not None:
        low, high = fit
    center = (low + high) / 2
    scale = scale_to / max(high - low) if scale_to else 1
    objects = []
    for piece in meshes:
        mesh = bpy.data.meshes.new(piece['id'])
        mesh.from_pydata([tuple((Vector(v) - center) * scale + offset) for v in piece['vertices']], [], piece['faces'])
        mesh.update()
        mesh.normals_split_custom_set_from_vertices(piece['normals'])
        for face in mesh.polygons:
            face.use_smooth = True
        obj = bpy.data.objects.new(piece['id'], mesh)
        bpy.context.collection.objects.link(obj)
        objects.append(obj)
        mat = bpy.data.materials.new(piece['id'])
        mat.use_nodes = True
        surface = mat.node_tree.nodes.get('Principled BSDF')
        surface.inputs['Base Color'].default_value = (*piece['color'], 1)
        surface.inputs['Metallic'].default_value = piece['metalness']
        surface.inputs['Roughness'].default_value = piece['roughness']
        obj.data.materials.append(mat)
    return objects

if comparison:
    # Both revisions use the union of their bounds, so no independent auto-fit can flatter either one.
    vertices = []
    for revision in ['before', 'after']:
        with open(os.path.join(folder, revision, 'door.json')) as source:
            vertices.extend(Vector(v) for p in json.load(source)['meshes'] for v in p['vertices'])
    fit = (Vector(tuple(min(v[k] for v in vertices) for k in range(3))),
           Vector(tuple(max(v[k] for v in vertices) for k in range(3))))
    for revision, x, title in [('before', -4.4, 'Previous geometry'), ('after', 4.4, 'Refined geometry')]:
        offset = right * x
        objects = add_model(revision + '/door', offset, 7.8, fit)
        group = bpy.data.collections.new(revision + '_light_receivers')
        for obj in objects:
            group.objects.link(obj)
        comparison_groups.append((offset, group))
        text(title, x, 4.1, 0.42)
    text('Hinged-panel construction refinement', 0, 5.5, 0.55)
    text('Same camera, scale and CPU lighting. Actual exported meshes and materials.', 0, 4.85, 0.26)
    text('Rounded plate outlines | Thicker edges | Tapered shoulders | Closer knuckles | Turned caps', 0, -4.5, 0.25)
    text('Geometry review only. This is not a Talkthrough screenshot or native rendering acceptance.', 0, -5.15, 0.22)
    span = 19
elif detail:
    add_model('inspect', Vector((0, -0.4, 0)), 8)
    text('Meaningful parts stay separate', 0, 5.1, 0.45)
    text('The pin moves with its end caps. The knuckles retain a real open bore.', 0, 4.45, 0.22)
    text('Exact exported Three.js geometry | CPU lighting preview, not an app screenshot', 0, -5.0, 0.19)
    span = 12
else:
    for name, x, title, caption in [
        ('door', -6.6, 'Door or access panel', '5 knuckles | 55 degree fold'),
        ('folding', 0, 'Folding-device hinge', '7 knuckles | 110 degree fold'),
        ('joint', 6.6, 'Compact mechanical joint', '3 knuckles | 30 degree fold'),
    ]:
        add_model(name, right * x, 5.8)
        text(title, x, 3.8, 0.37)
        text(caption, x, -4.05, 0.27)
    text('One reusable hinged-panel component', 0, 5.5, 0.6)
    text('Bounded controls. Separate leaves, knuckles and pin. Ordinary scene actions.', 0, 4.7, 0.31)
    text('Exact exported Three.js geometry | Independently fitted views | CPU preview, not an app screenshot', 0, -5.2, 0.25)
    span = 22

world = bpy.context.scene.world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.025, 0.038, 0.065, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.65
# Link identical local light rigs to each comparison model: putting models side by side
# under a single rig would give each revision a different highlight and would not be a fair comparison.
for offset, group in (comparison_groups if comparison else [(Vector((0, 0, 0)), None)]):
    for position, power, size in [((-6, 9, 10), 2600, 10), ((8, 2, 6), 1800, 8), ((0, 8, -8), 2200, 8)]:
        local = Vector(position)
        bpy.ops.object.light_add(type='AREA', location=local + offset)
        lamp = bpy.context.object
        lamp.data.energy = power
        lamp.data.shape = 'DISK'
        lamp.data.size = size
        lamp.rotation_euler = (-local).to_track_quat('-Z', 'Y').to_euler()
        if group is not None:
            lamp.light_linking.receiver_collection = group
            lamp.light_linking.blocker_collection = group
bpy.ops.object.camera_add(location=-forward * 24)
camera = bpy.context.object
camera.rotation_mode = 'QUATERNION'
camera.rotation_quaternion = rotation
camera.data.type = 'ORTHO'
camera.data.ortho_scale = span
scene = bpy.context.scene
scene.camera = camera
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 512
scene.cycles.use_denoising = False
scene.render.threads_mode = 'FIXED'
scene.render.threads = 2
scene.render.resolution_x = 1200 if detail else 1800
scene.render.resolution_y = 1200 if detail or comparison else 1050
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = output
scene.view_settings.view_transform = 'AgX'
bpy.ops.render.render(write_still=True)
