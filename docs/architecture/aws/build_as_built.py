#!/usr/bin/env python3
"""Generate docs/architecture/aws/eventide-aws-as-built.drawio (draw.io, native AWS stencils): the production layout of 2026-10-26.

Same visual language as AWS_Diagram_Tool.jpg: every box is an AWS icon (category colour) with its
caption underneath; pods are EKS icons; subnets/VPC/region are AWS group boxes. Every position
and arrow route is placed by hand below: arrows only run horizontally or vertically (polylines
through explicit waypoints), one colour per traffic class, each flow numbered and explained in the
legend. Edit the numbers here, then re-export:

    python3 docs/architecture/aws/build_as_built.py
    cd docs/architecture/aws      # one format per run; running as your own user keeps the files removable
    docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD:/data" rlespinasse/drawio-export \
        -f png --scale 1 --border 20 --remove-page-suffix --output render /data
    docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD:/data" rlespinasse/drawio-export \
        -f svg --scale 1 --border 20 --remove-page-suffix --embed-svg-fonts false --output render /data
    mv render/eventide-aws-as-built.* . && rmdir render

(`docker context use default` first if the client points at Docker Desktop.)
The as-built facts come from the code and the Terraform/Helm in this repo; the target
architecture (AWS_Diagram_Tool.jpg) is kept next to this file unchanged.
"""
import html
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "eventide-aws-as-built.drawio")
W, H = 3400, 2420

# ---- colours: one per traffic class --------------------------------------------------
C_USER = "#1565C0"      # a user's request
C_INT = "#455A64"       # service-to-service call inside the cluster
C_DATA = "#2E7D32"      # data store (RDS, Redis, S3)
C_MAIL = "#C2185B"      # async mail (SQS)
C_EXT = "#EF6C00"       # external API (Stripe, Google, Gmail)
C_OPS = "#6A1B9A"       # deploy / control plane
C_CFG = "#757575"       # configuration relation (DNS delegation, ALIAS, certificate)
AWS_NAVY = "#232F3E"

# AWS category colours (same as the original diagram)
COMPUTE, NETWORK, DATABASE, STORAGE, INTEGRATION, SECURITY, DEV, GENERIC = (
    "#ED7100", "#8C4FFF", "#C925D1", "#7AA116", "#E7157B", "#DD344C", "#C925D1", "#5A6C86")

cells = []          # (z, xml)
boxes = {}          # id -> (x, y, w, h)


def esc(s):
    return html.escape(s, quote=True)


def add(z, xml):
    cells.append((z, xml))


def box(id, label, x, y, w, h, style, z=2):
    boxes[id] = (x, y, w, h)
    add(z, f'<mxCell id="{id}" value="{esc(label)}" style="{style}" vertex="1" parent="1">'
           f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')


def group(id, label, x, y, w, h, icon, stroke, dashed=False, fill="none", z=0, valign="top", extra=""):
    st = ("points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];"
          "outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=13;fontStyle=1;collapsible=0;recursiveResize=0;pointerEvents=0;"
          f"shape=mxgraph.aws4.group;grIcon={icon};strokeColor={stroke};fillColor={fill};verticalAlign={valign};align=left;spacingLeft=34;spacingBottom=6;"
          f"fontColor={stroke};dashed={1 if dashed else 0};{extra}")
    box(id, label, x, y, w, h, st, z=z)


def panel(id, label, x, y, w, h, stroke, dashed=True, fill="none", z=1, fontsize=12, align="left", valign="top", fcolor=None, bold=1):
    st = (f"rounded=1;arcSize=2;whiteSpace=wrap;html=1;fontSize={fontsize};fontStyle={bold};strokeColor={stroke};fillColor={fill};"
          f"fontColor={fcolor or stroke};align={align};verticalAlign={valign};spacingLeft=10;spacingTop=4;spacingBottom=6;"
          f"dashed={1 if dashed else 0};strokeWidth=2;")
    box(id, label, x, y, w, h, st, z=z)


def text(id, html_text, x, y, w, h, size=12, align="left", color=AWS_NAVY, z=2, extra=""):
    st = (f"text;html=1;whiteSpace=wrap;overflow=hidden;align={align};verticalAlign=top;fontSize={size};fontColor={color};"
          f"strokeColor=none;fillColor=none;{extra}")
    box(id, html_text, x, y, w, h, st, z=z)


def icon(id, res, label, cx, cy, fill, size=56, sub="", pending=False, where="below", lw=170, lh=52, dx=0, dy=0, dark=False):
    """AWS icon + its caption in a separate text box (below/above/left/right), so no arrow ever runs through text."""
    x, y = cx - size // 2, cy - size // 2
    if dark:    # outline style, like the Users icon of the original
        st = (f"sketch=0;outlineConnect=0;gradientColor=none;fillColor={AWS_NAVY};strokeColor=none;dashed=0;html=1;aspect=fixed;pointerEvents=1;"
              f"shape=mxgraph.aws4.{res};")
    else:
        st = ("sketch=0;outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;aspect=fixed;"
              f"strokeColor=#ffffff;fillColor={fill};dashed=0;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.{res};")
    boxes[id] = (x, y, size, size)
    body = f"<b>{label}</b>" + (f"<br><font style='font-size:10px' color='#444444'>{sub}</font>" if sub else "")
    if where == "below":
        lx, ly, al = cx - lw // 2, y + size + 2, "center"
    elif where == "above":
        lx, ly, al = cx - lw // 2, y - lh - 2, "center"
    elif where == "right":
        lx, ly, al = x + size + 6, cy - lh // 2, "left"
    else:  # left
        lx, ly, al = x - lw - 6, cy - lh // 2, "right"
    lx, ly = lx + dx, ly + dy
    if pending:
        x0, y0 = min(x, lx) - 10, min(y, ly) - 8
        x1, y1 = max(x + size, lx + lw) + 10, max(y + size, ly + lh) + 8
        add(1, f'<mxCell id="{id}_pend" value="" style="rounded=1;arcSize=6;strokeColor={C_EXT};dashed=1;strokeWidth=2;fillColor=#FFF8E1;" '
               f'vertex="1" parent="1"><mxGeometry x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" as="geometry"/></mxCell>')
    add(2, f'<mxCell id="{id}" value="" style="{st}" vertex="1" parent="1">'
           f'<mxGeometry x="{x}" y="{y}" width="{size}" height="{size}" as="geometry"/></mxCell>')
    if label or sub:
        text(f"{id}_lbl", body, lx, ly, lw, lh, 12, align=al)


def constraint(node, pt, prefix):
    x, y, w, h = boxes[node]
    fx = min(1.0, max(0.0, (pt[0] - x) / w))
    fy = min(1.0, max(0.0, (pt[1] - y) / h))
    return f"{prefix}X={fx:.4f};{prefix}Y={fy:.4f};{prefix}Dx=0;{prefix}Dy=0;"


_eid = [0]


def edge(src, tgt, pts, color, dashed=False, width=3, both=False):
    """Polyline through absolute `pts`; pts[0] sits on src's border, pts[-1] on tgt's border."""
    _eid[0] += 1
    st = (f"html=1;rounded=0;strokeColor={color};strokeWidth={width};endArrow=block;endFill=1;endSize=7;"
          f"startArrow={'block' if both else 'none'};startFill=1;startSize=7;jumpStyle=arc;jumpSize=10;"
          + ("dashed=1;dashPattern=8 5;" if dashed else "")
          + constraint(src, pts[0], "exit") + constraint(tgt, pts[-1], "entry"))
    mid = "".join(f'<mxPoint x="{x}" y="{y}"/>' for x, y in pts[1:-1])
    arr = f'<Array as="points">{mid}</Array>' if mid else ""
    add(3, f'<mxCell id="e{_eid[0]}" value="" style="{st}" edge="1" parent="1" source="{src}" target="{tgt}">'
           f'<mxGeometry relative="1" as="geometry">{arr}</mxGeometry></mxCell>')


def badge(text_, x, y, color):
    """A flow number (+ very short caption) sitting on the arrow at (x, y)."""
    w = 16 + int(6.4 * len(text_))
    st = (f"rounded=1;arcSize=40;whiteSpace=wrap;html=1;fontSize=11;fontStyle=1;strokeColor={color};strokeWidth=2;fillColor=#ffffff;"
          f"fontColor={color};align=center;verticalAlign=middle;spacing=0;")
    _eid[0] += 1
    add(4, f'<mxCell id="b{_eid[0]}" value="{esc(text_)}" style="{st}" vertex="1" parent="1">'
           f'<mxGeometry x="{x - w // 2}" y="{y - 11}" width="{w}" height="22" as="geometry"/></mxCell>')


# =====================================================================================
# Title
# =====================================================================================
text("title", "<b style='font-size:26px'>Eventide — AWS infrastructure, as built (production layout)</b>", 20, 14, 1800, 40, 26)
text("subtitle",
     "AWS Academy Learner Lab · us-east-1 · dedicated VPC 10.20.0.0/16, single-AZ (1a; 1b holds only the subnets ALB / EKS / RDS require) · "
     "arrows point from the caller to the callee · live at <b>https://eventide.creasy.club</b> · "
     "differences from the target <code>AWS_Diagram_Tool.jpg</code> are listed at the bottom", 20, 52, 3300, 40, 13, color="#555555")

# =====================================================================================
# Containers: AWS Cloud > Region > VPC > subnets
# =====================================================================================
group("aws", "AWS Cloud", 210, 190, 2800, 1580, "mxgraph.aws4.group_aws_cloud_alt", AWS_NAVY)
group("region", "Region us-east-1", 235, 235, 2750, 1510, "mxgraph.aws4.group_region", "#147EBA", dashed=True)
group("vpc", "VPC eventide  10.20.0.0/16  (network is permanent and free; NAT, endpoints, EKS, data and edge are rebuilt by make up)", 600, 275, 1620, 1255,
      "mxgraph.aws4.group_vpc2", "#8C4FFF")
group("public", "Public subnets  1a (NAT) + 1b (ALB)", 620, 330, 270, 1140, "mxgraph.aws4.group_security_group", "#7AA116", extra="strokeWidth=2;")
group("edge", "Private subnet, NO route out · edge node group (2 × t3.small, eventide/tier=edge)", 930, 330, 870, 430,
      "mxgraph.aws4.group_security_group", "#00A4A6", extra="strokeWidth=2;", fill="#F2FBFB")
group("egress", "Private subnet, route out through the NAT · egress node group (1 × t3.small, eventide/tier=egress)", 930, 1040, 870, 430,
      "mxgraph.aws4.group_security_group", "#00A4A6", extra="strokeWidth=2;", fill="#F2FBFB")
group("data", "Private data subnet  1a  (+ empty 1b for the subnet group)", 1850, 330, 340, 1140,
      "mxgraph.aws4.group_security_group", "#00A4A6", extra="strokeWidth=2;", fill="#F2FBFB")
panel("endpoints", "VPC endpoints: how the no-egress edge tier reaches AWS", 930, 800, 870, 200, "#8C4FFF", dashed=True, fill="#FAF5FF", z=1, fontsize=11)

# =====================================================================================
# Outside AWS (left): users, Cloudflare
# =====================================================================================
icon("users", "users", "Users", 90, 520, AWS_NAVY, size=64, sub="browser", where="below", lw=120, lh=40, dark=True)
icon("cloudflare", "generic_application", "Cloudflare", 100, 1100, GENERIC, sub="apex creasy.club lives here<br>4 NS records for <i>eventide</i><br>(set once, by hand)",
     where="below", lw=170, lh=60)

# Region level: DNS, certificate, WAF
icon("r53", "route_53", "Route 53", 300, 440, NETWORK, size=64, sub="zone eventide.creasy.club", where="above", lw=190, lh=44)
icon("waf", "waf", "AWS WAF", 520, 312, SECURITY, size=64, sub="Common · KnownBadInputs ·<br>IP reputation · rate limit<br><b>block mode</b>", where="below", lw=180, lh=64)
icon("acm", "certificate_manager", "ACM", 520, 780, SECURITY, size=64, sub="cert for<br>eventide.creasy.club", where="below", lw=130, lh=44)

# Public subnets
icon("alb", "application_load_balancer", "ALB", 755, 520, NETWORK, size=64, sub=":443 TLS (ACM) · :80 → 301<br>idle 3600 s · health /healthz", where="below", lw=190, lh=46, dx=-20)
icon("nat", "nat_gateway", "NAT gateway", 755, 1250, NETWORK, size=64, sub="the only way out of the<br>egress tier (0.0.0.0/0 → NAT)", where="above", lw=190, lh=46)

# Edge subnet
icon("ingress", "eks", "ingress-nginx ×2", 1040, 520, COMPUTE, sub="NodePort 30080 · body 20m<br>real client IP from X-Forwarded-For", where="above", lw=230, lh=46, dy=-8)
icon("web", "eks", "web ×1", 1300, 400, COMPUTE, sub="Bun server · SPA + OG head", where="right", lw=190, lh=36)
icon("event", "eks", "event ×2", 1300, 520, COMPUTE, sub="/api/events · HPA 2→8", where="below", lw=200, lh=36)
icon("registration", "eks", "registration ×2", 1300, 640, COMPUTE, sub="/api/regis · WebSocket", where="below", lw=200, lh=36)
icon("metrics", "eks", "metrics-server", 1600, 700, COMPUTE, sub="feeds the HPA", where="right", lw=120, lh=36, dy=-6)

# Egress subnet
icon("auth", "eks", "auth ×2", 1300, 1130, COMPUTE, sub="/api/auth", where="below", lw=200, lh=36)
icon("payment", "eks", "payment ×1", 1300, 1250, COMPUTE, sub="/api/payment", where="below", lw=200, lh=36)
icon("mail", "eks", "mail-worker ×1", 1300, 1370, COMPUTE, sub="no HTTP · SQS consumer", where="below", lw=200, lh=36)

# Endpoint hub (middle row)
icon("s3ep", "endpoints", "S3 gateway endpoint", 1100, 870, NETWORK, size=52, sub="free · edge, egress and data routes", where="below", lw=200, lh=44, dy=0)
icon("vpce", "endpoints", "Interface endpoints ×6", 1620, 915, NETWORK, size=52, sub="ecr.api · ecr.dkr · sts · ec2 · sqs ·<br>secretsmanager (private DNS)", where="below", lw=260, lh=44)

# Data subnet
icon("proxy", "rds_proxy", "RDS Proxy", 2020, 450, DATABASE, size=64, sub="TLS · pools every pod's connections", where="below", lw=190, lh=44)
icon("rds", "rds", "RDS PostgreSQL", 2020, 640, DATABASE, size=64, sub="db.t3.micro · single AZ · SSL<br>migrations connect direct", where="below", lw=190, lh=52)
icon("redis", "elasticache", "ElastiCache Redis", 2020, 1130, DATABASE, size=64, sub="1 node · TLS + AUTH<br>session cache · event cache ·<br>live-seat pub/sub", where="below", lw=190, lh=64)

# Internet gateway at the VPC's bottom edge
icon("igw", "internet_gateway", "Internet gateway", 755, 1530, NETWORK, size=52, sub="", where="left", lw=140, lh=24)

# Region-level services (right column)
icon("ecr", "ecr", "ECR", 2560, 520, COMPUTE, sub="7 service repos + 2 mirrors<br>(ingress-nginx, metrics-server)", where="below", lw=190, lh=52)
icon("sm", "secrets_manager", "Secrets Manager", 2560, 700, SECURITY, sub="RDS Proxy reads rds-master<br>google · gmail · stripe · endpoints", where="below", lw=230, lh=44)
icon("s3", "s3", "S3 uploads", 2560, 870, STORAGE, size=64, sub="<b>public/*</b> readable, the rest private", where="right", lw=170, lh=44, dy=-6, dx=-4)
panel("sqsbox", "", 2480, 1010, 170, 190, "#E7157B", dashed=False, fill="#FCE4EC", z=1)
icon("sqs", "sqs", "SQS mail-queue", 2565, 1055, INTEGRATION, size=48, sub="30 s visibility<br>10 s long poll", where="below", lw=150, lh=52)
panel("dlqbox", "", 2750, 1010, 160, 190, "#E7157B", dashed=False, fill="#FCE4EC", z=1)
icon("dlq", "sqs", "SQS DLQ", 2830, 1055, INTEGRATION, size=48, sub="after 5 receives", where="below", lw=150, lh=44)
icon("cw", "cloudwatch", "CloudWatch", 2560, 1330, "#E7157B", size=56, sub="15 alarms + dashboard<br><i>eventide</i>", where="below", lw=180, lh=44)
icon("sns", "sns", "SNS alerts", 2830, 1330, INTEGRATION, size=48, sub="topic eventide-alerts<br>(no subscriber yet)", where="below", lw=150, lh=44)
icon("ekscp", "eks", "EKS control plane", 2560, 1580, COMPUTE, sub="AWS-managed · private + public endpoint", where="right", lw=200, lh=36)

# External SaaS (outside AWS, right)
icon("google", "generic_application", "Google OAuth", 3200, 1160, GENERIC, sub="sign-in with Google", where="below", lw=170, lh=36)
icon("stripe", "generic_application", "Stripe", 3200, 1000, GENERIC, sub="Checkout, refunds, webhook", where="below", lw=170, lh=36)
icon("gmail", "email", "Gmail SMTP", 3200, 1320, "#EA4335", sub="App Password", where="below", lw=170, lh=36)

# Bottom band: developer + GitHub
panel("dev_box", "", 250, 1850, 350, 140, C_OPS, dashed=False, fill="#F3E5F5", z=1)
icon("dev", "client", "Developer laptop", 310, 1920, DEV, sub="make up · mirror · deploy · down<br>make secrets · make ci-creds<br>Terraform + AWS CLI (infra/aws.env)", where="right", lw=240, lh=66)
panel("gh_box", "", 2300, 1850, 600, 140, C_EXT, dashed=True, fill="#F6F8FA", z=1)
icon("gh", "generic_application", "GitHub Actions", 2370, 1920, GENERIC, sub="check · images (every PR)<br>deploy on push to main<br>NOT live: needs make ci-creds", where="right", lw=400, lh=66)

# =====================================================================================
# Flows
# =====================================================================================
# Every path starts on its source's border and ends on its target's border (otherwise draw.io
# straightens the last segment into a diagonal): overlapping paths simply share a lane.
IN_R = 1328                         # right edge of the pod icons
IN_L = 1272                         # left edge of the pod icons
BUS, BUS2 = 1825, 1840              # the data buses, between the tiers and the data subnet
DB, RD = 450, 1130                  # where the buses enter the proxy and the cache
Y = dict(web=400, event=520, registration=640, auth=1130, payment=1250, mail=1370)

# 1  DNS lookup (Users -> Route 53)
edge("users", "r53", [(90, 488), (90, 440), (268, 440)], C_USER, dashed=True)
badge("1 DNS", 160, 440, C_USER)
# 2  HTTPS (Users -> ALB)
edge("users", "alb", [(122, 520), (723, 520)], C_USER)
badge("2 HTTPS :443", 420, 520, C_USER)
# 3  ALB -> ingress-nginx
edge("alb", "ingress", [(787, 520), (1012, 520)], C_USER)
badge("3", 900, 520, C_USER)
# 4  ingress -> web / event / registration (edge tier) and down to auth / payment (egress tier)
edge("ingress", "web", [(1040, 492), (1040, 400), (IN_L, 400)], C_USER)
edge("ingress", "event", [(1068, 520), (IN_L, 520)], C_USER)
edge("ingress", "registration", [(1040, 548), (1040, 640), (IN_L, 640)], C_USER)
edge("ingress", "auth", [(1056, 548), (1056, 1130), (IN_L, 1130)], C_USER)
edge("ingress", "payment", [(1056, 548), (1056, 1250), (IN_L, 1250)], C_USER)
badge("4 by path", 1056, 740, C_USER)
# 5  /files -> S3 (rewrite): ingress -> S3 gateway endpoint
edge("ingress", "s3ep", [(1024, 548), (1024, 870), (1074, 870)], C_DATA)
badge("5 /files/*", 1024, 800, C_DATA)
# 6  get-session (event, registration, payment -> auth)
edge("event", "auth", [(IN_R, 520), (1400, 520), (1400, 1130), (IN_R, 1130)], C_INT, width=2.5)
edge("registration", "auth", [(IN_R, 640), (1400, 640), (1400, 1130), (IN_R, 1130)], C_INT, width=2.5)
edge("payment", "auth", [(IN_R, 1250), (1400, 1250), (1400, 1130), (IN_R, 1130)], C_INT, width=2.5)
badge("6 get-session", 1400, 960, C_INT)
# 16 web -> event
edge("web", "event", [(1300, 428), (1300, 492)], C_INT, width=2.5)
badge("16", 1300, 460, C_INT)
# 7  SQL through the proxy (bus 1), 8 Redis (bus 2)
for n, d in (("event", -12), ("registration", -12), ("auth", -18), ("payment", -12)):
    edge(n, "proxy", [(IN_R, Y[n] + d), (BUS, Y[n] + d), (BUS, DB), (1988, DB)], C_DATA)
for n, d in (("event", 12), ("registration", 12), ("auth", 18), ("payment", 12)):
    edge(n, "redis", [(IN_R, Y[n] + d), (BUS2, Y[n] + d), (BUS2, RD), (1988, RD)], C_DATA)
badge("7 SQL (TLS)", BUS, 330 + 120, C_DATA)
badge("8 rediss", BUS2, 1000, C_DATA)
edge("proxy", "rds", [(2020, 482), (2020, 608)], C_DATA)
# tier -> endpoint hub: edge goes down, egress goes up
edge("edge", "endpoints", [(1200, 760), (1200, 800)], C_DATA, width=2.5)
badge("9 S3 · 10 SQS · 19 ECR (edge tier)", 1200, 780, C_DATA)
edge("egress", "endpoints", [(1200, 1040), (1200, 1000)], C_DATA, width=2.5)
badge("9 · 10 · 11 (egress tier)", 1200, 1020, C_DATA)
# hub -> region services
edge("s3ep", "s3", [(1126, 870), (2528, 870)], C_DATA)
badge("9 S3 put/get", 2250, 870, C_DATA)
edge("vpce", "ecr", [(1646, 915), (2350, 915), (2350, 520), (2528, 520)], C_OPS, dashed=True, width=2.5)
badge("19 image pull", 2350, 640, C_OPS)
edge("vpce", "sm", [(1646, 915), (2350, 915), (2350, 700), (2528, 700)], C_OPS, dashed=True, width=2.5)
edge("vpce", "sqsbox", [(1646, 915), (2350, 915), (2350, 1105), (2480, 1105)], C_MAIL, both=True)
badge("10 send · 11 receive", 2350, 1060, C_MAIL)
edge("sqsbox", "dlqbox", [(2650, 1105), (2750, 1105)], C_MAIL, dashed=True, width=2.5)
badge("redrive", 2700, 1105, C_MAIL)
# 12 / 13 / 15  everything that leaves goes NAT -> IGW -> internet
edge("auth", "nat", [(IN_L, 1118), (975, 1118), (975, 1250), (787, 1250)], C_EXT)
edge("payment", "nat", [(IN_L, 1250), (787, 1250)], C_EXT)
edge("mail", "nat", [(IN_L, 1370), (975, 1370), (975, 1250), (787, 1250)], C_EXT)
badge("12 · 13 · 15 out", 975, 1190, C_EXT)
edge("nat", "igw", [(755, 1282), (755, 1504)], C_EXT)
for tgt, y in (("stripe", 1000), ("google", 1160), ("gmail", 1320)):
    edge("igw", tgt, [(755, 1556), (755, 1620), (3100, 1620), (3100, y), (3172, y)], C_EXT)
badge("13", 3136, 1000, C_EXT)
badge("15", 3136, 1160, C_EXT)
badge("12", 3136, 1320, C_EXT)
badge("internet gateway → internet", 1900, 1620, C_EXT)
# 14 Stripe webhook: Stripe -> public site -> WAF -> ALB (outer loop over the top)
edge("stripe", "alb", [(3200, 972), (3200, 130), (775, 130), (775, 488)], C_EXT, dashed=True)
badge("14 webhook POST https://eventide.creasy.club/api/payment/webhook (WAF allows the path; the signature is checked by payment)", 1900, 130, C_EXT)

# DNS / certificate / WAF configuration
edge("cloudflare", "r53", [(128, 1100), (300, 1100), (300, 472)], C_CFG, dashed=True, width=2.5)
badge("NS (once)", 214, 1100, C_CFG)
edge("r53", "alb", [(332, 440), (740, 440), (740, 488)], C_CFG, dashed=True, width=2.5)
badge("ALIAS", 600, 440, C_CFG)
edge("waf", "alb", [(552, 312), (700, 312), (700, 500), (723, 500)], C_CFG, dashed=True, width=2.5)
badge("attached", 626, 312, C_CFG)
edge("acm", "alb", [(552, 780), (690, 780), (690, 540), (723, 540)], C_CFG, dashed=True, width=2.5)
badge("TLS cert", 690, 650, C_CFG)

# Monitoring and the control plane
edge("vpc", "cw", [(2220, 1330), (2528, 1330)], C_OPS, dashed=True, width=2.5)
badge("20 metrics", 2330, 1330, C_OPS)
edge("cw", "sns", [(2592, 1330), (2806, 1330)], C_OPS, dashed=True, width=2.5)
badge("alarm", 2700, 1330, C_OPS)
edge("ekscp", "vpc", [(2528, 1580), (2220, 1580), (2220, 1530)], C_OPS, dashed=True, width=2.5)
badge("manages nodes and pods", 2380, 1580, C_OPS)

# Deploy / operations
edge("gh_box", "ekscp", [(2560, 1850), (2560, 1612)], C_OPS, dashed=True)
badge("18b helm + kubectl", 2560, 1800, C_OPS)
edge("gh_box", "ecr", [(2880, 1850), (2930, 1850), (2930, 520), (2592, 520)], C_OPS, dashed=True)
badge("18a docker push", 2930, 1800, C_OPS)
edge("gh_box", "sm", [(2830, 1850), (2960, 1850), (2960, 700), (2592, 700)], C_OPS, dashed=True, width=2.5)
badge("18c read secrets", 2960, 1500, C_OPS)
edge("dev_box", "gh_box", [(600, 1920), (2300, 1920)], C_OPS, dashed=True)
badge("git push main → deploy job", 1450, 1920, C_OPS)
edge("dev_box", "region", [(420, 1850), (420, 1745)], C_OPS, dashed=True)
badge("17 terraform apply (make up / down)", 420, 1800, C_OPS)

# =====================================================================================
# Legend
# =====================================================================================
legend_rows = [
    (C_USER, "1", "DNS lookup of eventide.creasy.club (Cloudflare delegates the name to Route 53, which answers with the ALB)"),
    (C_USER, "2", "HTTPS request, in through the internet gateway — the WAF inspects it, TLS ends at the ALB with the ACM certificate"),
    (C_USER, "3", "ALB → ingress-nginx NodePort (the ALB is built by Terraform, not by Kubernetes)"),
    (C_USER, "4", "ingress routes by path: / → web · /api/events · /api/regis (+WebSocket) · /api/auth · /api/payment"),
    (C_DATA, "5", "/files/* is rewritten by the ingress to S3 through the gateway endpoint; only public/* is readable"),
    (C_INT, "6", "event, registration, payment ask auth to validate the session cookie (get-session, cached in Redis 60 s)"),
    (C_DATA, "7", "auth, event, registration, payment → RDS Proxy → RDS (one database, one role, pool of 4 per pod)"),
    (C_DATA, "8", "same four → ElastiCache over TLS with an AUTH token (session cache, event cache, live-seat pub/sub)"),
    (C_DATA, "9", "S3 reads/writes (avatar, cover, gallery) from either tier use the S3 gateway endpoint"),
    (C_MAIL, "10", "same four enqueue mail (template + props) on SQS, through the sqs interface endpoint"),
    (C_MAIL, "11", "mail-worker long-polls, renders the React Email template, deletes; 5 failed receives → DLQ"),
    (C_EXT, "12", "mail-worker → NAT → internet gateway → Gmail SMTP (dry-run log when no App Password)"),
    (C_EXT, "13", "payment → NAT → Stripe (checkout, verify, refund)"),
    (C_EXT, "14", "Stripe → webhook, over the public https site (the endpoint registered in Stripe)"),
    (C_EXT, "15", "auth → NAT → Google (sign-in)"),
    (C_INT, "16", "web asks event for the page's title / image (Open Graph head)"),
    (C_OPS, "17", "make up/down = terraform apply, state in S3 (permanent: VPC, ECR, S3, SQS, secrets, DNS · nightly: EKS, NAT, endpoints, RDS, Proxy, Redis, ALB, WAF, alarms)"),
    (C_OPS, "18", "push to main: build + push images (a), helm upgrade + kubectl + db-migrate (b), read secrets (c)"),
    (C_OPS, "19", "kubelet pulls images from ECR through the ecr.api / ecr.dkr endpoints; ingress-nginx and metrics-server come from the ECR mirrors"),
    (C_OPS, "20", "15 CloudWatch alarms (ALB 5xx / health / latency, RDS, Proxy pinning, Redis, DLQ, node CPU, WAF burst) → SNS; dashboard eventide"),
]


def row(c, n, t):
    return f"<font color='{c}'><b>{n}</b></font>&nbsp;&nbsp;{t}<br>"


half = (len(legend_rows) + 1) // 2
left_html = "<b style='font-size:14px'>Flows (1/2)</b><br>" + "".join(row(c, n, t) for c, n, t in legend_rows[:half])
right_html = "<b style='font-size:14px'>Flows (2/2)</b><br>" + "".join(row(c, n, t) for c, n, t in legend_rows[half:])
right_html += ("<br><b>Colours</b><br><font color='%s'><b>━ user request</b></font> · <font color='%s'><b>━ service call</b></font> · "
               "<font color='%s'><b>━ data store</b></font> · <font color='%s'><b>━ mail (SQS)</b></font> · <font color='%s'><b>━ external API</b></font><br>"
               "<font color='%s'><b>┅ deploy / control</b></font> · <font color='%s'><b>┅ DNS / certificate / WAF setup</b></font> · "
               "<font color='%s'><b>▭ orange dashed box = not live yet</b></font>"
               % (C_USER, C_INT, C_DATA, C_MAIL, C_EXT, C_OPS, C_CFG, C_EXT))
panel("legend_l", left_html, 250, 2040, 1620, 250, "#9E9E9E", dashed=False, fill="#FAFAFA", z=1, fontsize=12, fcolor=AWS_NAVY, bold=0)
panel("legend_r", right_html, 1890, 2040, 1260, 250, "#9E9E9E", dashed=False, fill="#FAFAFA", z=1, fontsize=12, fcolor=AWS_NAVY, bold=0)
notes = ("<b style='font-size:14px'>Differences from the target architecture (AWS_Diagram_Tool.jpg)</b><br>"
         "<b>CloudFront → ALB + WAF</b> (CloudFront is denied in the Learner Lab; the WAF is not in the target) · "
         "<b>NLB → ALB</b> · <b>Shield</b>: only the automatic Shield Standard (Advanced is denied) · "
         "<b>not production-grade, by lab constraint</b>: single AZ, no RDS backups (the database is rebuilt every session), "
         "pods use the 4-hour session credentials (no IRSA), EKS API public, WAF and ALB logging off, platform up only during sessions (the $50 cap).")
panel("notes", notes, 250, 2300, 2900, 100, "#EF6C00", dashed=True, fill="#FFF8E1", z=1, fontsize=12, fcolor=AWS_NAVY, bold=0)

# =====================================================================================
xml = ['<mxfile host="build_as_built.py" version="24.0.0">',
       f'<diagram id="eventide-aws-as-built" name="AWS as built"><mxGraphModel dx="{W}" dy="{H}" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" '
       f'fold="1" page="0" pageScale="1" pageWidth="{W}" pageHeight="{H}" math="0" shadow="0" background="#ffffff"><root>',
       '<mxCell id="0"/><mxCell id="1" parent="0"/>']
xml += [c for _, c in sorted(cells, key=lambda t: t[0])]
xml += ['</root></mxGraphModel></diagram></mxfile>']
with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(xml))
print("wrote", OUT, f"({len(cells)} cells)")
