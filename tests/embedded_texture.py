from pathlib import Path
import base64,json,struct,zlib

OUT=Path('/tmp/ruzgar-lab-browser-checks')
OUT.mkdir(exist_ok=True)

def fixture() -> Path:
 positions=struct.pack('<9f',0,0,0,0,1,0,0,0,1)
 uv=struct.pack('<6f',0,0,1,0,0,1)
 def chunk(kind: bytes, data: bytes) -> bytes:
  return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
 png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b'\x00\xff\x00\x00\xff'))+chunk(b'IEND',b'')
 buffer=positions+uv+png
 doc={'asset':{'version':'2.0'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0}], 'meshes':[{'primitives':[{'attributes':{'POSITION':0,'TEXCOORD_0':1},'material':0}]}], 'materials':[{'pbrMetallicRoughness':{'baseColorTexture':{'index':0}}}], 'textures':[{'source':0}], 'images':[{'bufferView':2,'mimeType':'image/png'}], 'buffers':[{'byteLength':len(buffer),'uri':'data:application/octet-stream;base64,'+base64.b64encode(buffer).decode()}], 'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':36},{'buffer':0,'byteOffset':36,'byteLength':24},{'buffer':0,'byteOffset':60,'byteLength':len(png)}], 'accessors':[{'bufferView':0,'componentType':5126,'count':3,'type':'VEC3','min':[0,0,0],'max':[0,1,1]},{'bufferView':1,'componentType':5126,'count':3,'type':'VEC2'}]}
 path=OUT/'embedded-texture.gltf';path.write_text(json.dumps(doc));return path
