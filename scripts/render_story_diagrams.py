"""Render presentation diagrams using the retained U6 visual conventions.

Run from the repository root with Python, passing --chrome to also render PNGs.
SVG sources remain beside the PNGs so diagrams can be edited independently.
"""
import argparse
import html
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
YELLOW, BLUE, PURPLE, LIGHT = '#fbefad', '#91cfe5', '#cfb2e8', '#e3d4f0'


class Canvas:
    def __init__(self, height, width=3000, sequence=False):
        self.width, self.height = width, height
        self.sequence = sequence
        self.parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
                      '<rect width="100%" height="100%" fill="white"/>',
                      '<defs><marker id="arrow" markerWidth="12" markerHeight="10" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10" fill="none" stroke="#171717" stroke-width="1.4"/></marker><marker id="sync" markerWidth="12" markerHeight="10" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#171717"/></marker></defs>']

    def text(self, x, y, label, size=32, anchor='middle', bold=False):
        self.parts.append(f'<text x="{x}" y="{y}" font-family="Leelawadee UI,Tahoma,sans-serif" font-size="{size}" text-anchor="{anchor}" font-weight="{700 if bold else 400}">{html.escape(label)}</text>')

    def box(self, x, y, w, h, fill='white', radius=0):
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="#171717" stroke-width="2.4"/>')

    def line(self, x, y, xx, yy, dash=False, arrow=False, gray=False):
        marker='sync' if self.sequence and not dash else 'arrow'
        self.parts.append(f'<path d="M{x},{y} L{xx},{yy}" fill="none" stroke="{"#999" if gray else "#171717"}" stroke-width="2.3"'+(' stroke-dasharray="11 10"' if dash else '')+(f' marker-end="url(#{marker})"' if arrow else '')+'/>')

    def message(self, x, xx, y, label, reply=False):
        if x == xx:
            self.line(x+8,y,x+190,y)
            self.line(x+190,y,x+190,y+42)
            self.line(x+190,y+42,x+8,y+42,arrow=True)
            self.text(x+215,y+24,label,29,'start')
        else:
            self.line(x,y,xx,y,dash=reply,arrow=True)
            self.text((x+xx)/2,y-18,label,29)

    def save(self, path):
        path.write_text(''.join(self.parts)+'</svg>', encoding='utf-8')


def sequence(story):
    names = ['นักศึกษา', story['view'], story['controller'], 'SQL Server']
    xs = [180, 740, 1510, 2570]
    if story['id'] == 1:
        names, xs = ['นักศึกษา','LoginView','AuthController','TU API','SQL Server'], [160,680,1390,2180,2900]
    elif story['id'] in (7,10):
        names, xs = names + ['PDF ส่วนตัว'], [160,680,1390,2180,2900]
    width = 3200 if len(names) == 5 else 3000
    height = 330 + sum(165 + 90*len(section[1]) for section in story['sections'])
    c = Canvas(height, width, sequence=True)
    for i,(x,name) in enumerate(zip(xs,names)):
        if i == 0:
            c.parts.append(f'<circle cx="{x}" cy="52" r="21" fill="{YELLOW}" stroke="#171717" stroke-width="2.4"/>')
            c.line(x,73,x,115); c.line(x-28,90,x+28,90); c.line(x,115,x-25,145); c.line(x,115,x+25,145)
        elif i in (1,2):
            c.parts.append(f'<circle cx="{x}" cy="80" r="40" fill="{BLUE}" stroke="#171717" stroke-width="2.4"/>')
            if i == 1:
                c.line(x-90,45,x-90,115); c.line(x-90,80,x-40,80)
            else:
                c.line(x-10,39,x-25,23); c.line(x-25,23,x-5,27)
        else:
            c.box(x-145,35,290,115)
            c.text(x,75,'«external»' if name=='TU API' else '«storage»' if name=='PDF ส่วนตัว' else '«database»',27)
        c.text(x,190 if i<3 else 120,name,34)
        if i==2:c.text(x,226,'Backend API',27)
        c.line(x,245,x,height-75,dash=True,gray=True)
    y=280
    for title,steps in story['sections']:
        c.text(55,y,title,34,'start',True); y+=85
        # Activation bars are local to each request/response, not whole lifelines.
        for j,(a,b,label,reply) in enumerate(steps):
            if not reply and a!=b:
                for k in range(j+1,len(steps)):
                    aa,bb,_,rr=steps[k]
                    if rr and aa==b and bb==a:
                        c.box(xs[b]-8,y+j*90,16,(k-j)*90, YELLOW if b==0 else BLUE)
                        break
        for j,(a,b,label,reply) in enumerate(steps):c.message(xs[a],xs[b],y+j*90,label,reply)
        y+=len(steps)*90+25
        c.line(45,y,width-45,y,dash=True,gray=True); y+=55
    c.text(width-55,height-25,'เส้นทึบ = คำขอ   เส้นประ = ผลตอบกลับ   แท่งสี = ช่วงทำงาน',26,'end')
    return c


def dataflow(story):
    heights=[800 if story['id']==1 and n==0 else 620 for n in range(len(story['flows']))]
    c=Canvas(140+sum(heights))
    c.text(50,65,'Diagram 0',43,'start')
    for n,(process,inputs,outputs,db_request,db_result,external) in enumerate(story['flows']):
        y=140+sum(heights[:n])
        extra_session=story['id']==1 and n==0
        c.box(85,y+160,440,165,YELLOW);c.text(305,y+255,'นักศึกษา',38)
        c.box(1090,y+65,560,575 if extra_session else 355,PURPLE,28)
        c.box(1090,y+140,560,425 if extra_session else 205)
        c.text(1120,y+115,f'1.{n+1}',33,'start');c.text(1370,y+255,process,38)
        c.message(525,1090,y+205,inputs)
        c.message(1090,525,y+300,outputs)
        c.box(2220,y+45,680,130,LIGHT);c.box(2220,y+45,125,130,'#e6e6e6')
        store_id,store_name=story.get('stores',{}).get(str(n),['D1','SQL Server'])
        c.text(2282,y+125,store_id,36);c.text(2622,y+125,store_name,36)
        c.message(1650,2220,y+80,db_request)
        c.message(2220,1650,y+150,db_result)
        if external:
            label,request,result=external
            c.box(2220,y+305,680,135,LIGHT if label.startswith('D2') else YELLOW)
            if label.startswith('D2'):
                c.box(2220,y+305,125,135,'#e6e6e6');c.text(2282,y+390,'D2',36)
                c.text(2622,y+390,label[3:],36)
            else:c.text(2560,y+390,label,36)
            c.message(1650,2220,y+335,request)
            c.message(2220,1650,y+415,result)
        if extra_session:
            c.box(2220,y+505,680,135,LIGHT);c.box(2220,y+505,125,135,'#e6e6e6')
            c.text(2282,y+590,'D2',36);c.text(2622,y+590,'Session ในหน่วยความจำ',32)
            c.message(1650,2220,y+535,'token ผู้ใช้ และวันหมดอายุ')
            c.message(2220,1650,y+615,'Session ที่สร้างแล้ว')
        if n<len(story['flows'])-1:c.line(45,y+heights[n]-70,2955,y+heights[n]-70,dash=True,gray=True)
    c.text(2950,c.height-25,'รหัส D เดียวกันที่วาดซ้ำหมายถึงแหล่งเก็บข้อมูลชุดเดียวกัน',27,'end')
    return c


def render_png(svg, chrome):
    # Headless rendering uses only local SVG and Windows Thai fonts.
    with tempfile.TemporaryDirectory(prefix='cs261-diagram-') as profile:
        from xml.etree import ElementTree
        attrs=ElementTree.parse(svg).getroot().attrib
        command=[chrome,'--headless','--disable-gpu','--hide-scrollbars','--no-first-run',
                 f'--user-data-dir={profile}',f'--screenshot={svg.with_suffix(".png")}',
                 f'--window-size={attrs["width"]},{attrs["height"]}',svg.as_uri()]
        result=subprocess.run(command,capture_output=True,timeout=45)
        if result.returncode or not svg.with_suffix('.png').exists():raise RuntimeError(result.stderr.decode(errors='replace'))


def main():
    import json
    parser=argparse.ArgumentParser();parser.add_argument('--chrome');args=parser.parse_args()
    stories=json.loads((ROOT/'docs/shared/diagrams/story-diagrams.json').read_text(encoding='utf-8'))
    for story in stories:
        folder=ROOT/f'docs/U{story["id"]}/design/diagrams';folder.mkdir(parents=True,exist_ok=True)
        for kind,draw in [('sequence',sequence),('dataflow',dataflow)]:
            svg=folder/f'u{story["id"]}-{kind}.svg';draw(story).save(svg)
            if args.chrome:render_png(svg,args.chrome)
        print(f'U{story["id"]}: sequence and dataflow rendered',flush=True)


if __name__=='__main__':main()
