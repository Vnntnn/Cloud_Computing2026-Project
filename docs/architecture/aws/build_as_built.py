#!/usr/bin/env python3
"""Generate docs/architecture/aws/eventide-aws-as-built.drawio (draw.io, native AWS stencils).

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
W, H = 3020, 2250

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
text("title", "<b style='font-size:26px'>Eventide — AWS infrastructure, as built</b>", 20, 14, 1400, 40, 26)
text("subtitle",
     "AWS Academy Learner Lab · us-east-1 · default VPC, public subnets only (no NAT) · arrows point from the caller to the callee · "
     "live at <b>https://eventide.creasy.club</b> · orange dashed box = not live yet (needs <code>make ci-creds</code>) · the target architecture is "
     "<code>AWS_Diagram_Tool.jpg</code> (unchanged)", 20, 52, 2300, 40, 13, color="#555555")

# =====================================================================================
# Containers: AWS Cloud > Region > VPC > public subnets > node group
# =====================================================================================
group("aws", "AWS Cloud", 210, 190, 2490, 1420, "mxgraph.aws4.group_aws_cloud_alt", AWS_NAVY)
group("region", "Region us-east-1", 235, 235, 2440, 1345, "mxgraph.aws4.group_region", "#147EBA", dashed=True)
group("vpc", "Default VPC 172.31.0.0/16", 590, 275, 1480, 1280, "mxgraph.aws4.group_vpc2", "#8C4FFF")
group("subnets", "Public subnets  us-east-1a / 1b / 1c  —  no NAT gateway", 605, 325, 1440, 1205, "mxgraph.aws4.group_security_group",
      "#7AA116", extra="strokeWidth=2;")
group("nodes", "EKS managed node group (Auto Scaling) — 2 × t3.medium (default t3.small) · namespaces: eventide, ingress-nginx",
      840, 385, 900, 1115, "mxgraph.aws4.group_auto_scaling_group", "#ED7100", dashed=True, fill="#FFFBF5", z=1, valign="bottom")
panel("api", "API services (Bun)", 1090, 515, 280, 545, "#546E7A", dashed=True, fill="#F5F7F8", z=1, fontsize=11)

# =====================================================================================
# Outside AWS (left): users, Cloudflare
# =====================================================================================
icon("users", "users", "Users", 90, 720, AWS_NAVY, size=64, sub="browser", where="above", lw=120, lh=40, dark=True)
icon("cloudflare", "generic_application", "Cloudflare", 100, 1150, GENERIC, sub="apex creasy.club lives here<br>4 NS records for <i>eventide</i><br>(set once, by hand)",
     where="below", lw=170, lh=60)

# Region level: DNS + certificate
icon("r53", "route_53", "Route 53", 290, 960, NETWORK, size=64, sub="zone eventide.creasy.club<br>ALIAS → NLB", where="right", lw=125, lh=44)
icon("acm", "certificate_manager", "ACM", 535, 960, SECURITY, size=64, sub="wildcard cert", where="below", lw=100, lh=36)

# VPC: NLB, pods, RDS
# vertical positions of the service column (125 px apart so captions never touch the next icon)
Y_WEB, Y_EVENT, Y_AUTH, Y_REG, Y_PAY, Y_MAIL = 430, 585, 710, 835, 960, 1225
icon("nlb", "network_load_balancer", "NLB", 720, 720, NETWORK, size=64, sub=":443 TLS (ACM)<br>:80 → :30080", where="above", lw=100, lh=46, dx=-60, dy=-12)
icon("ingress", "eks", "ingress-nginx ×2", 945, 720, COMPUTE, sub="NodePort 30080 · body 20m", where="below", lw=190, lh=36)
icon("web", "eks", "web ×1", 1230, Y_WEB, COMPUTE, sub="Bun server · SPA +<br>Open Graph head", where="right", lw=150, lh=52)
icon("event", "eks", "event ×2", 1230, Y_EVENT, COMPUTE, sub="/api/events · HPA 2→8", where="below", lw=190, lh=36)
icon("auth", "eks", "auth ×2", 1230, Y_AUTH, COMPUTE, sub="/api/auth", where="below", lw=190, lh=36)
icon("registration", "eks", "registration ×2", 1230, Y_REG, COMPUTE, sub="/api/regis · live-seats WebSocket", where="below", lw=210, lh=36)
icon("payment", "eks", "payment ×1", 1230, Y_PAY, COMPUTE, sub="/api/payment", where="below", lw=190, lh=36)
icon("mail", "eks", "mail-worker ×1", 1230, Y_MAIL, COMPUTE, sub="no HTTP · SQS consumer", where="below", lw=190, lh=36)
icon("redis", "eks", "redis ×1 (pod)", 1560, 790, COMPUTE, sub="no persistence · session<br>cache, event cache, pub/sub", where="right", lw=150, lh=52)
icon("migrate", "eks", "db-migrate Job", 1560, 580, COMPUTE, sub="Helm pre-upgrade hook<br>drizzle-kit migrate on RDS", where="right", lw=150, lh=52)
icon("metrics", "eks", "metrics-server + HPA", 1560, 1390, COMPUTE, sub="scales event 2 → 8 pods<br>at 60 % CPU", where="right", lw=150, lh=52)
icon("rds", "rds", "RDS PostgreSQL", 1880, 860, DATABASE, size=64, sub="db.t3.micro · single AZ · SSL<br>database <i>eventide</i><br>reachable from the nodes only", where="above", lw=190, lh=64)

# Internet gateway: an icon on the VPC's right edge and a tall gate that every outbound lane crosses
panel("igw", "Internet gateway — every outbound call leaves here (nodes have public IPs, no NAT)", 2048, 440, 34, 930, "#8C4FFF", dashed=False,
      fill="#F3E5F5", z=1, fontsize=11, align="center", valign="middle")
cells[-1] = (1, cells[-1][1].replace('whiteSpace=wrap;', 'whiteSpace=wrap;horizontal=0;'))
icon("igwicon", "internet_gateway", "", 2065, 398, NETWORK, size=44)

# Region-level services (right column)
icon("s3", "s3", "S3 uploads", 2230, 470, STORAGE, size=64, sub="avatars, event covers, gallery<br><b>public/*</b> readable, the rest private", where="below", lw=200, lh=52)
panel("sqsbox", "", 2160, 1000, 170, 220, "#E7157B", dashed=False, fill="#FCE4EC", z=1)
icon("sqs", "sqs", "SQS mail-queue", 2245, 1045, INTEGRATION, size=48, sub="30 s visibility<br>10 s long poll", where="below", lw=150, lh=52)
panel("dlqbox", "", 2400, 1000, 160, 220, "#E7157B", dashed=False, fill="#FCE4EC", z=1)
icon("dlq", "sqs", "SQS DLQ", 2480, 1045, INTEGRATION, size=48, sub="dead letters<br>after 5 receives", where="below", lw=150, lh=52)
icon("ecr", "ecr", "ECR", 2420, 1340, COMPUTE, sub="7 repositories", where="above", lw=150, lh=40)
icon("ekscp", "eks", "EKS control plane", 2250, 1440, COMPUTE, sub="AWS-managed", where="above", lw=150, lh=40)
icon("sm", "secrets_manager", "Secrets Manager", 2590, 1440, SECURITY, sub="rds-master · google<br>gmail · stripe", where="above", lw=150, lh=52)

# External SaaS (outside AWS, right) — the original draws these as generic application icons
icon("google", "generic_application", "Google OAuth", 2850, Y_AUTH + 2, GENERIC, sub="sign-in with Google<br>on, because the site is https", where="below", lw=170, lh=54)
icon("stripe", "generic_application", "Stripe", 2850, Y_PAY, GENERIC, sub="Checkout, refunds, webhook<br>keys in Secrets Manager", where="below", lw=170, lh=54)
icon("gmail", "email", "Gmail SMTP", 2850, 1245, "#EA4335", sub="App Password", where="below", lw=170, lh=40)

# Bottom band: developer + GitHub
panel("dev_box", "", 250, 1680, 350, 140, C_OPS, dashed=False, fill="#F3E5F5", z=1)
icon("dev", "client", "Developer laptop", 310, 1750, DEV, sub="make up · deploy · down<br>make secrets · make ci-creds<br>Terraform + AWS CLI (infra/aws.env)", where="right", lw=240, lh=66)
panel("gh_box", "", 2200, 1680, 440, 140, C_EXT, dashed=True, fill="#F6F8FA", z=1)
icon("gh", "generic_application", "GitHub Actions", 2270, 1750, GENERIC, sub="check · images (every PR)<br>deploy on push to main<br>needs make ci-creds", where="right", lw=290, lh=66)

# =====================================================================================
# Flows
# =====================================================================================
X_IN, X_OUT = 1202, 1258        # left / right edge of the service icons
X_STUB = 1415                   # vertical stub where event + auth join the S3 lane
Y_S3, Y_REDIS, Y_DB = 470, 790, 860
Y_SEND, Y_RECV, Y_GMAIL = 1040, 1200, 1245
# 1  DNS lookup (Users -> Route 53)
edge("users", "r53", [(90, 752), (90, 960), (258, 960)], C_USER, dashed=True)
badge("1 DNS", 90, 860, C_USER)
# 2  HTTPS (Users -> NLB)
edge("users", "nlb", [(122, 720), (688, 720)], C_USER)
badge("2 HTTPS :443", 400, 720, C_USER)
# 3  NLB -> ingress
edge("nlb", "ingress", [(752, 720), (917, 720)], C_USER)
badge("3", 835, 720, C_USER)
# 4  ingress -> web / API services
edge("ingress", "web", [(973, 708), (1050, 708), (1050, Y_WEB), (X_IN, Y_WEB)], C_USER)
edge("ingress", "api", [(973, 732), (1090, 732)], C_USER)
badge("4 by path", 1050, 580, C_USER)
# 5  /files -> S3 (rewrite)
edge("ingress", "s3", [(945, 692), (945, 358), (2230, 358), (2230, 438)], C_DATA)
badge("5 /files/* → S3", 1500, 358, C_DATA)
# 6  get-session (event/registration/payment -> auth), inside the API panel
edge("event", "auth", [(X_IN, Y_EVENT), (1130, Y_EVENT), (1130, Y_AUTH - 18), (X_IN, Y_AUTH - 18)], C_INT, width=2.5)
edge("payment", "auth", [(X_IN, Y_PAY), (1130, Y_PAY), (1130, Y_AUTH), (X_IN, Y_AUTH)], C_INT, width=2.5)
edge("registration", "auth", [(X_IN, Y_REG), (1130, Y_REG), (1130, Y_AUTH + 18), (X_IN, Y_AUTH + 18)], C_INT, width=2.5)
badge("6", 1130, 650, C_INT)
# 16 web -> event (head tags)
edge("web", "event", [(1230, Y_WEB + 28), (1230, Y_EVENT - 28)], C_INT, width=2.5)
badge("16", 1230, 495, C_INT)
# 9  S3 writes: event + auth -> S3 (stub, then the S3 lane)
edge("event", "s3", [(X_OUT, Y_EVENT - 15), (X_STUB, Y_EVENT - 15), (X_STUB, Y_S3), (2198, Y_S3)], C_DATA)
edge("auth", "s3", [(X_OUT, Y_AUTH - 15), (X_STUB, Y_AUTH - 15), (X_STUB, Y_S3), (2198, Y_S3)], C_DATA)
badge("9 S3 put/get", 1800, Y_S3, C_DATA)
# 15 Google OAuth (auth)
edge("auth", "google", [(X_OUT, Y_AUTH + 14), (2822, Y_AUTH + 14)], C_EXT)
badge("15 OIDC", 2350, Y_AUTH + 14, C_EXT)
# 8  Redis (API services -> redis pod)
edge("api", "redis", [(1370, Y_REDIS), (1532, Y_REDIS)], C_DATA)
badge("8", 1450, Y_REDIS, C_DATA)
# 7  DB (API services -> RDS)
edge("api", "rds", [(1370, Y_DB), (1848, Y_DB)], C_DATA)
badge("7 SQL", 1700, Y_DB, C_DATA)
# 13 Stripe (payment)
edge("payment", "stripe", [(X_OUT, Y_PAY), (2822, Y_PAY)], C_EXT)
badge("13 checkout/refund", 1900, Y_PAY, C_EXT)
# 10 SQS send (API services -> queue)
edge("api", "sqsbox", [(1370, Y_SEND), (2160, Y_SEND)], C_MAIL)
badge("10 send mail", 1850, Y_SEND, C_MAIL)
# 11 SQS receive/delete (mail-worker <-> queue), redrive to DLQ
edge("mail", "sqsbox", [(X_OUT, Y_RECV), (2160, Y_RECV)], C_MAIL, both=True)
badge("11 long-poll · delete", 1850, Y_RECV, C_MAIL)
edge("sqsbox", "dlqbox", [(2330, 1110), (2400, 1110)], C_MAIL, dashed=True, width=2.5)
badge("redrive", 2365, 1110, C_MAIL)
# 12 Gmail (mail-worker)
edge("mail", "gmail", [(X_OUT, Y_GMAIL), (2822, Y_GMAIL)], C_EXT)
badge("12 SMTP", 1900, Y_GMAIL, C_EXT)
# 14 Stripe webhook (outer loop over the top: Stripe -> NLB)
edge("stripe", "nlb", [(2878, Y_PAY), (2985, Y_PAY), (2985, 130), (720, 130), (720, 688)], C_EXT, dashed=True)
badge("14 webhook POST https://eventide.creasy.club/api/payment/webhook (via Route 53 → NLB → ingress → payment)", 1700, 130, C_EXT)

# DNS / certificate configuration (set up once, then maintained by `make up`)
edge("cloudflare", "r53", [(128, 1150), (290, 1150), (290, 992)], C_CFG, dashed=True, width=2.5)
badge("NS (once)", 205, 1150, C_CFG)
edge("r53", "nlb", [(290, 928), (290, 810), (705, 810), (705, 752)], C_CFG, dashed=True, width=2.5)
badge("ALIAS", 470, 810, C_CFG)
edge("acm", "nlb", [(535, 928), (535, 850), (735, 850), (735, 752)], C_CFG, dashed=True, width=2.5)
badge("TLS cert", 640, 850, C_CFG)

# Images and the control plane
edge("ecr", "nodes", [(2392, 1340), (1740, 1340)], C_OPS, dashed=True, width=2.5)
badge("19 image pull (kubelet)", 2000, 1340, C_OPS)
edge("ekscp", "nodes", [(2222, 1440), (1740, 1440)], C_OPS, dashed=True, width=2.5)
badge("19 manages nodes and pods", 2000, 1440, C_OPS)

# Deploy / operations
edge("gh_box", "ecr", [(2420, 1680), (2420, 1368)], C_OPS, dashed=True)
badge("18a docker push", 2420, 1640, C_OPS)
edge("gh_box", "ekscp", [(2250, 1680), (2250, 1468)], C_OPS, dashed=True)
badge("18b helm + kubectl", 2250, 1640, C_OPS)
edge("gh_box", "sm", [(2590, 1680), (2590, 1468)], C_OPS, dashed=True)
badge("18c read secrets", 2590, 1640, C_OPS)
edge("dev_box", "gh_box", [(600, 1750), (2200, 1750)], C_OPS, dashed=True)
badge("git push main → deploy job", 1400, 1750, C_OPS)
edge("dev_box", "region", [(420, 1680), (420, 1580)], C_OPS, dashed=True)
badge("17 terraform apply (make up / down)", 420, 1640, C_OPS)
edge("dev_box", "sm", [(420, 1820), (420, 1890), (2810, 1890), (2810, 1440), (2618, 1440)], C_OPS, dashed=True, width=2.5)
badge("17b make secrets (.env → Secrets Manager)", 1400, 1890, C_OPS)

# =====================================================================================
# Legend
# =====================================================================================
legend_rows = [
    (C_USER, "1", "DNS lookup of eventide.creasy.club (Cloudflare delegates the name to Route 53, which answers with the NLB)"),
    (C_USER, "2", "HTTPS request — TLS ends at the NLB with the ACM certificate"),
    (C_USER, "3", "NLB → ingress-nginx NodePort (the NLB is built by Terraform, not by Kubernetes)"),
    (C_USER, "4", "ingress routes by path: / → web · /api/auth · /api/events · /api/regis (+WebSocket) · /api/payment"),
    (C_DATA, "5", "/files/* is rewritten by the ingress straight to S3; only public/* is readable"),
    (C_INT, "6", "event, registration, payment ask auth to validate the session cookie (get-session, cached in Redis 60 s)"),
    (C_DATA, "7", "auth, event, registration, payment → RDS (one database, one role, pool of 4 per pod)"),
    (C_DATA, "8", "same four → Redis (session cache, event cache, live-seat pub/sub)"),
    (C_DATA, "9", "auth (avatar) and event (cover, gallery, OG reads) write/read S3 with the session credentials"),
    (C_MAIL, "10", "same four enqueue mail (template + props) on SQS"),
    (C_MAIL, "11", "mail-worker long-polls, renders the React Email template, deletes; 5 failed receives → DLQ"),
    (C_EXT, "12", "mail-worker → Gmail SMTP (dry-run log when no App Password)"),
    (C_EXT, "13", "payment → Stripe (checkout, verify, refund)"),
    (C_EXT, "14", "Stripe → webhook, over the public https site (the endpoint registered in Stripe)"),
    (C_EXT, "15", "auth → Google (sign-in; on because the site is https)"),
    (C_INT, "16", "web asks event for the page's title / image (Open Graph head)"),
    (C_OPS, "17", "make up/down = terraform apply, state in S3 (permanent: ECR, S3, SQS, secrets, DNS · nightly: EKS, RDS, NLB); make secrets"),
    (C_OPS, "18", "push to main: build + push images (a), helm upgrade + kubectl + db-migrate (b), read secrets (c)"),
    (C_OPS, "19", "kubelet pulls images from ECR; EKS control plane manages the nodes"),
]


def row(c, n, t):
    return f"<font color='{c}'><b>{n}</b></font>&nbsp;&nbsp;{t}<br>"


half = (len(legend_rows) + 1) // 2
left_html = "<b style='font-size:14px'>Flows (1/2)</b><br>" + "".join(row(c, n, t) for c, n, t in legend_rows[:half])
right_html = "<b style='font-size:14px'>Flows (2/2)</b><br>" + "".join(row(c, n, t) for c, n, t in legend_rows[half:])
right_html += ("<br><b>Colours</b><br><font color='%s'><b>━ user request</b></font> · <font color='%s'><b>━ service call</b></font> · "
               "<font color='%s'><b>━ data store</b></font> · <font color='%s'><b>━ mail (SQS)</b></font> · <font color='%s'><b>━ external API</b></font><br>"
               "<font color='%s'><b>┅ deploy / control</b></font> · <font color='%s'><b>┅ DNS / certificate setup</b></font> · "
               "<font color='%s'><b>▭ orange dashed box = not live yet</b></font>"
               % (C_USER, C_INT, C_DATA, C_MAIL, C_EXT, C_OPS, C_CFG, C_EXT))
panel("legend_l", left_html, 250, 1960, 1200, 235, "#9E9E9E", dashed=False, fill="#FAFAFA", z=1, fontsize=12, fcolor=AWS_NAVY, bold=0)
panel("legend_r", right_html, 1470, 1960, 1200, 235, "#9E9E9E", dashed=False, fill="#FAFAFA", z=1, fontsize=12, fcolor=AWS_NAVY, bold=0)

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
