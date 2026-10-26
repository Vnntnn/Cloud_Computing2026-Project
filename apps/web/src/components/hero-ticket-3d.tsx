import { useEffect, useRef, type RefObject } from "react";

/** Where the mouse is over the hero, in client pixels. HomeHero keeps it (only for a mouse, only without reduced motion) and the CSS lantern pool follows the same pointer. */
export type HeroCursor = { x: number; y: number; on: boolean };

/** Theme tokens are oklch, which three's Color cannot parse; a 2D canvas can, and hands back sRGB bytes. */
function rgbOf(token: string): [number, number, number] {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return [1, 1, 1];
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(token).trim() || "#fff";
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

const css = (c: [number, number, number], a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const sequence = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** The site's one easing, --ease-out-expo, as a closed form: fast out of the gate, a long settle. */
const expo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * clamp01(t)));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The hero's centrepiece: lantern-lit admission tickets, drawn live in WebGL. One gesture lights both layers: the warm lamp that
 * follows the mouse is the same pointer that opens the CSS lantern pool on the photograph, so where the photo glows the tickets'
 * clear coat and foil catch the light. The front ticket rises like a lantern on load, takes one glint, then floats; it hinges on its
 * perforation when hovered and tears off when clicked (the `.date-ticket` motion of the cards, in 3D). Embers drift up out of the
 * lanterns, sized by their distance from the focus plane as a stand-in for depth of field. Everything is procedural: the reflections
 * are a painted canvas, the fleck of the paper a generated map. three loads as its own chunk; rendering stops off screen or with the
 * tab hidden; reduced motion draws one still frame; the frame time is watched and the quality steps down on a slow machine.
 */
export function HeroTicket3D({ className, cursor }: { className?: string; cursor?: RefObject<HeroCursor> }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let stop = () => {};
    let gone = false;

    import("three").then(async (THREE) => {
      if (gone) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true, powerPreference: "high-performance" });
      } catch {
        return;
      }
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
      const phone = () => el.clientWidth / el.clientHeight < 1.25;
      const quality = { dpr: Math.min(devicePixelRatio, phone() ? 1.5 : 2), embers: 1, emberTier: 0 };
      renderer.setPixelRatio(quality.dpr);
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1;

      const sun = rgbOf("--sun");
      const sunDeep = rgbOf("--sun-deep");
      const dusk = rgbOf("--dusk");
      const duskLow = rgbOf("--dusk-low");
      const terracotta = rgbOf("--poster-2");
      const ink = rgbOf("--sun-foreground");
      const color = (c: [number, number, number]) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(color(dusk), 9, 19);
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
      camera.position.set(0, 0, 9);

      const disposables: { dispose(): void }[] = [];
      const own = <T extends { dispose(): void }>(d: T) => (disposables.push(d), d);

      // reflections: a painted sky of warm lantern blobs over the dusk, so the clear coat shows what the ticket is lit by
      const pmrem = own(new THREE.PMREMGenerator(renderer));
      {
        const sky = document.createElement("canvas");
        sky.width = 512;
        sky.height = 256;
        const g = sky.getContext("2d");
        if (g) {
          g.fillStyle = css(dusk);
          g.fillRect(0, 0, 512, 256);
          const glow = g.createLinearGradient(0, 40, 0, 256);
          glow.addColorStop(0, css(duskLow, 0.6));
          glow.addColorStop(0.55, css(sunDeep, 0.35));
          glow.addColorStop(1, css(sun, 0.55));
          g.fillStyle = glow;
          g.fillRect(0, 0, 512, 256);
          const next = sequence(20261026);
          for (let i = 0; i < 30; i++) {
            const x = next() * 512;
            const y = 80 + next() * 160;
            const r = 8 + next() * 16;
            const halo = g.createRadialGradient(x, y, 0, x, y, r * 3);
            halo.addColorStop(0, css(sun, 0.95));
            halo.addColorStop(0.35, css(sunDeep, 0.5));
            halo.addColorStop(1, css(sunDeep, 0));
            g.fillStyle = halo;
            g.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
          }
        }
        const tex = new THREE.CanvasTexture(sky);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = pmrem.fromEquirectangular(tex).texture;
        tex.dispose();
      }

      // light: a warm lamp that rides the pointer, a warm rim from the lanterns below and a cold fill from the sky
      const lamp = new THREE.PointLight(color(sun), 16, 10, 2);
      lamp.position.set(1.2, 1.4, 2.6);
      scene.add(lamp);
      const under = new THREE.DirectionalLight(color(sunDeep), 1.4);
      under.position.set(1, -3, -2);
      scene.add(under);
      const key = new THREE.DirectionalLight(0xfff0d6, 0.9);
      key.position.set(-3, 3, 6);
      scene.add(key);
      const skyLight = new THREE.DirectionalLight(color(duskLow), 0.6);
      skyLight.position.set(-2, 4, 3);
      scene.add(skyLight);

      // the grade and the grain, inside every material (no composer, which an alpha canvas over the page would make awkward): a little
      // more saturation and contrast, a teal lift in the shadows to sit in the dusk, and film grain so the CG shares the photograph's noise
      const shared = { uTime: { value: 0 }, uGrain: { value: phone() ? 0.025 : 0.035 } };
      const look = (m: InstanceType<typeof THREE.MeshPhysicalMaterial>) => {
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uTime = shared.uTime;
          shader.uniforms.uGrain = shared.uGrain;
          shader.fragmentShader = shader.fragmentShader
            .replace("void main() {", "uniform float uTime;\nuniform float uGrain;\nvoid main() {")
            .replace(
              "#include <tonemapping_fragment>",
              `#include <tonemapping_fragment>
              {
                vec3 c = gl_FragColor.rgb;
                float l = dot(c, vec3(.299, .587, .114));
                c = mix(vec3(l), c, .96);
                c = (c - .5) * 1.05 + .5;
                c += vec3(.0, .012, .016) * (1. - l);
                float n = fract(sin(dot(floor(gl_FragCoord.xy) + floor(uTime * 24.), vec2(12.9898, 78.233))) * 43758.5453);
                c += (n - .5) * uGrain;
                gl_FragColor.rgb = clamp(c, 0., 1.);
              }`,
            );
        };
        m.customProgramCacheKey = () => "eventide-look";
        return m;
      };

      // the paper's fleck: a roughness map of small bright specks, so the light breaks up as the ticket turns
      const flecks = (() => {
        const n = 256;
        const data = new Uint8Array(n * n * 4);
        const next = sequence(7);
        for (let i = 0; i < n * n; i++) {
          const v = 150 + Math.round((next() - 0.5) * 14);
          data.set([v, v, v, 255], i * 4);
        }
        for (let i = 0; i < 1400; i++) {
          const at = Math.floor(next() * n * n) * 4;
          const v = 96 + Math.round(next() * 40);
          data[at] = data[at + 1] = data[at + 2] = v;
        }
        const t = own(new THREE.DataTexture(data, n, n, THREE.RGBAFormat));
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(3, 1.5);
        t.needsUpdate = true;
        return t;
      })();

      // geometry: a ticket cut along its perforation into a body and a stub, each inflated by a deep round bevel; a half-circle is bitten
      // out of the top and bottom edge at the cut, as on the date tickets of the cards
      const [w, h, r, bite] = [3.1, 1.55, 0.3, 0.2];
      const cut = w * 0.23;
      const body = new THREE.Shape();
      body.moveTo(-w / 2 + r, -h / 2);
      body.lineTo(cut - bite, -h / 2);
      body.absarc(cut, -h / 2, bite, Math.PI, Math.PI / 2, true);
      body.lineTo(cut, h / 2 - bite);
      body.absarc(cut, h / 2, bite, -Math.PI / 2, -Math.PI, true);
      body.lineTo(-w / 2 + r, h / 2);
      body.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
      body.lineTo(-w / 2, -h / 2 + r);
      body.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
      const stub = new THREE.Shape();
      stub.moveTo(cut, -h / 2 + bite);
      stub.absarc(cut, -h / 2, bite, Math.PI / 2, 0, true);
      stub.lineTo(w / 2 - r, -h / 2);
      stub.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
      stub.lineTo(w / 2, h / 2 - r);
      stub.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
      stub.lineTo(cut + bite, h / 2);
      stub.absarc(cut, h / 2, bite, 0, -Math.PI / 2, true);
      stub.lineTo(cut, -h / 2 + bite);
      const bevel = 0.17;
      const depth = 0.12;
      const extrude = (shape: InstanceType<typeof THREE.Shape>) => {
        const g = own(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 10, curveSegments: 20 }));
        g.translate(0, 0, -depth / 2);
        g.computeVertexNormals();
        return g;
      };
      const bodyGeo = extrude(body);
      const stubGeo = extrude(stub);
      const front = depth / 2 + bevel + 0.004;

      // what is printed: the wordmark and the logo's wave lines as hot foil (metal, glossy, letterpressed), the stub's words and its barcode
      const font = getComputedStyle(document.body).fontFamily;
      const printOf = (draw: (g: CanvasRenderingContext2D, rgb: string) => void, cw: number, ch: number) => {
        const make = (rgb: string) => {
          const c = document.createElement("canvas");
          c.width = cw;
          c.height = ch;
          const g = c.getContext("2d");
          if (g) {
            if (rgb === "#fff") {
              g.fillStyle = "#000";
              g.fillRect(0, 0, cw, ch);
            }
            g.lineCap = "round";
            g.textBaseline = "alphabetic";
            draw(g, rgb);
          }
          const t = own(new THREE.CanvasTexture(c));
          t.colorSpace = rgb === "#fff" ? THREE.NoColorSpace : THREE.SRGBColorSpace;
          t.anisotropy = renderer.capabilities.getMaxAnisotropy();
          return t;
        };
        return { map: make(css(ink)), foil: make("#fff") };
      };
      const bodyPrint = printOf(
        (g, rgb) => {
          g.strokeStyle = g.fillStyle = rgb;
          g.lineWidth = 12;
          for (const y of [210, 260, 310]) {
            g.beginPath();
            for (let x = 110; x <= 470; x += 8) g.lineTo(x, y + Math.sin(((x - 110) / 360) * Math.PI * 2.4) * 24);
            g.stroke();
          }
          g.font = `800 150px ${font}`;
          g.fillText("Eventide", 110, 560);
        },
        1140,
        768,
      );
      const stubPrint = printOf(
        (g, rgb) => {
          g.strokeStyle = g.fillStyle = rgb;
          g.font = `700 54px ${font}`;
          g.save();
          g.translate(170, 690);
          g.rotate(-Math.PI / 2);
          g.fillText("ADMIT ONE", 0, 0);
          g.restore();
          const next = sequence(11);
          let x = 260;
          while (x < 360) {
            const bw = 4 + Math.round(next() * 10);
            g.fillRect(x, 90, bw, 560);
            x += bw + 6 + Math.round(next() * 8);
          }
        },
        512,
        768,
      );

      const bodyMat = (c: [number, number, number]) =>
        look(new THREE.MeshPhysicalMaterial({ color: color(c), roughness: 0.42, roughnessMap: flecks, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.3, sheenColor: color(sunDeep), envMapIntensity: 1.0 }));
      const printMat = (p: { map: InstanceType<typeof THREE.CanvasTexture>; foil: InstanceType<typeof THREE.CanvasTexture> }) =>
        look(
          new THREE.MeshPhysicalMaterial({
            map: p.map,
            metalnessMap: p.foil,
            metalness: 1,
            roughnessMap: p.foil,
            roughness: 0.2,
            bumpMap: p.foil,
            bumpScale: 1.5,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            envMapIntensity: 2.4,
          }),
        );
      // a holographic strip on the stub, kept to gold, rose and teal by a narrow, thick film range
      const holoMat = look(new THREE.MeshPhysicalMaterial({ color: color(sun), roughness: 0.25, metalness: 0.2, iridescence: 1, iridescenceIOR: 1.3, iridescenceThicknessRange: [250, 420], clearcoat: 1, envMapIntensity: 1.2 }));
      const mats = [bodyMat(sun), bodyMat(terracotta), bodyMat(duskLow)];
      const printed = [printMat(bodyPrint), printMat(stubPrint)];
      for (const m of [...mats, ...printed, holoMat]) own(m);
      const bodyPlane = own(new THREE.PlaneGeometry(cut + w / 2, h * 0.98));
      const stubPlane = own(new THREE.PlaneGeometry(w / 2 - cut, h * 0.98));
      const strip = own(new THREE.PlaneGeometry(0.09, h * 0.84));

      // tickets: the front one whole (body, stub on a hinge at the perforation); the two behind are plain, smaller and fade into the fog
      const poses = [
        { x: 0.2, y: -0.1, z: 0, rz: -0.2, ry: -0.28, s: 1, delay: 180 },
        { x: -1.9, y: 1.35, z: -2.5, rz: 0.32, ry: 0.4, s: 0.7, delay: 0 },
        { x: 1.8, y: -1.5, z: -4, rz: 0.2, ry: -0.5, s: 0.6, delay: 90 },
      ];
      const group = new THREE.Group();
      scene.add(group);
      const tickets = poses.map((p, n) => {
        const t = new THREE.Group();
        const b = new THREE.Mesh(bodyGeo, mats[n]);
        t.add(b);
        const hinge = new THREE.Group();
        hinge.position.x = cut;
        const s = new THREE.Mesh(stubGeo, mats[n]);
        s.position.x = -cut;
        hinge.add(s);
        t.add(hinge);
        if (n === 0) {
          const bp = new THREE.Mesh(bodyPlane, printed[0]);
          bp.position.set((cut - w / 2) / 2, 0, front);
          t.add(bp);
          const sp = new THREE.Mesh(stubPlane, printed[1]);
          sp.position.set((w / 2 - cut) / 2, 0, front);
          hinge.add(sp);
          const hs = new THREE.Mesh(strip, holoMat);
          hs.position.set((w / 2 - cut) * 0.16, 0, front + 0.003);
          hinge.add(hs);
        }
        group.add(t);
        return { t, hinge, p, hits: n === 0 ? [b, s] : [] };
      });
      const frontTicket = tickets[0];

      // embers: points that rise out of the lanterns, sized and dimmed by their distance from the focus plane; the lamp pushes them aside
      const emberCount = phone() ? 140 : 420;
      const emberGeo = own(new THREE.BufferGeometry());
      {
        const next = sequence(99);
        const pos = new Float32Array(emberCount * 3);
        const seed = new Float32Array(emberCount);
        const speed = new Float32Array(emberCount);
        for (let i = 0; i < emberCount; i++) {
          pos.set([(next() - 0.5) * 8, (next() - 0.5) * 6, (next() - 0.5) * 6 + (i < 12 ? 3 : 0)], i * 3);
          seed[i] = next();
          speed[i] = 0.15 + next() * 0.3;
        }
        emberGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        emberGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
        emberGeo.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
      }
      const emberU = {
        uTime: { value: 0 },
        uPx: { value: 1 },
        uFocus: { value: 9 },
        uFadeY: { value: phone() ? 0.32 : 0 },
        uIn: { value: 0 },
        uLamp: { value: new THREE.Vector3(0, 0, 9) },
        uSun: { value: color(sun) },
        uWarm: { value: color(sunDeep) },
      };
      const emberMat = own(
        new THREE.ShaderMaterial({
          uniforms: emberU,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          vertexShader: `
            uniform float uTime, uPx, uFocus, uFadeY, uIn; uniform vec3 uLamp;
            attribute float aSeed, aSpeed; varying float vA; varying float vCore;
            void main() {
              vec3 p = position; p.y = mod(p.y + uTime * aSpeed + 3., 6.) - 3.;
              p.x += sin(uTime * .6 + aSeed * 6.283) * .18;
              vec3 d = p - uLamp; float f = exp(-dot(d, d) * 1.2); p += normalize(d + 1e-4) * f * .5;
              vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
              float coc = abs(-mv.z - uFocus);
              gl_PointSize = min((2. + coc * 5.) * uPx / -mv.z, 64.);
              float flick = .65 + .35 * sin(uTime * (3. + aSeed * 4.) + aSeed * 40.);
              float ny = gl_Position.y / gl_Position.w * .5 + .5;
              vA = uIn * flick / (1. + coc * coc * 1.4) * smoothstep(uFadeY, uFadeY + .25, ny) * smoothstep(0., .3, 3. - abs(p.y));
              vCore = 1. / (1. + coc * 3.);
            }`,
          fragmentShader: `
            uniform vec3 uSun, uWarm; varying float vA; varying float vCore;
            void main() {
              float r = length(gl_PointCoord - .5);
              float a = smoothstep(.5, 0., r) * vA;
              vec3 c = mix(uWarm, uSun, smoothstep(.25, 0., r) * vCore);
              gl_FragColor = vec4(c * a, a);
            }`,
        }),
      );
      const embers = new THREE.Points(emberGeo, emberMat);
      embers.frustumCulled = false;
      scene.add(embers);

      // the burst when the stub tears off: a few sparks thrown from the perforation
      const sparkN = 40;
      const sparkGeo = own(new THREE.BufferGeometry());
      sparkGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(sparkN * 3), 3));
      sparkGeo.setAttribute("aA", new THREE.BufferAttribute(new Float32Array(sparkN), 1));
      const sparkMat = own(
        new THREE.ShaderMaterial({
          uniforms: { uPx: emberU.uPx, uSun: emberU.uSun },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          vertexShader: `uniform float uPx; attribute float aA; varying float vA;
            void main() { vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = 5. * uPx / -mv.z; vA = aA; }`,
          fragmentShader: `uniform vec3 uSun; varying float vA;
            void main() { float a = smoothstep(.5, 0., length(gl_PointCoord - .5)) * vA; gl_FragColor = vec4(uSun * a, a); }`,
        }),
      );
      const sparks = new THREE.Points(sparkGeo, sparkMat);
      sparks.frustumCulled = false;
      scene.add(sparks);
      const sparkV = Array.from({ length: sparkN }, () => new THREE.Vector3());
      const sparkLife = new Float32Array(sparkN);

      // pointer: the mouse over the hero, eased, mapped to a point on the plane just in front of the front ticket
      const eased = { x: 0, y: 0, on: false };
      const ray = new THREE.Raycaster();
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.6);
      const ndc = new THREE.Vector2();
      const point = new THREE.Vector3();
      const cast = (clientX: number, clientY: number) => {
        const box = el.getBoundingClientRect();
        ndc.set(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
      };
      const aim = (clientX: number, clientY: number) => {
        cast(clientX, clientY);
        return ray.ray.intersectPlane(plane, point) ? point : null;
      };
      const hitsFront = (clientX: number, clientY: number) => {
        cast(clientX, clientY);
        return ray.intersectObjects(frontTicket.hits, false).length > 0;
      };

      const state = {
        t0: 0,
        glintAt: 1500,
        stub: { phase: "on" as "on" | "gone" | "back", at: 0, v: new THREE.Vector3(), w: new THREE.Vector3(), hover: 0 },
      };
      const section = el.closest("section");
      const interactive = "a,button,input,label,select,textarea,[role=search],[role=button]";
      const onDown = (e: PointerEvent) => {
        if (still || state.stub.phase !== "on" || (e.target instanceof Element && e.target.closest(interactive))) return;
        if (!hitsFront(e.clientX, e.clientY)) return;
        const s = state.stub;
        s.phase = "gone";
        s.at = performance.now();
        s.v.set(1.4, 2.2, 0.8);
        s.w.set(2.5, 1.2, 4);
        const at = sparkGeo.attributes.position as InstanceType<typeof THREE.BufferAttribute>;
        const origin = frontTicket.hinge.getWorldPosition(new THREE.Vector3());
        sparkV.forEach((v, i) => {
          const a = Math.random() * Math.PI * 2;
          v.set(Math.cos(a) * (0.6 + Math.random() * 1.4), Math.sin(a) * (0.6 + Math.random() * 1.4) + 0.8, (Math.random() - 0.5) * 1.2);
          sparkLife[i] = 1;
          at.setXYZ(i, origin.x, origin.y + (Math.random() - 0.5) * h * 0.8, origin.z);
        });
      };
      let overStub = false;
      const onHover = (e: PointerEvent) => {
        if (still || e.pointerType !== "mouse" || !fine) return;
        overStub = !(e.target instanceof Element && e.target.closest(interactive)) && hitsFront(e.clientX, e.clientY);
        section?.classList.toggle("cursor-pointer", overStub);
      };

      const size = () => {
        const { clientWidth: cw, clientHeight: ch } = el;
        if (!cw || !ch) return;
        renderer.setSize(cw, ch, false);
        camera.aspect = cw / ch;
        const narrow = cw / ch < 1.25;
        camera.position.set(narrow ? 0.3 : 0, narrow ? -1 : 0, narrow ? 13 : 9);
        camera.updateProjectionMatrix();
        // the fog starts at the front ticket whatever the camera's distance, so the tickets behind fade, never the one in front
        if (scene.fog instanceof THREE.Fog) {
          scene.fog.near = camera.position.z;
          scene.fog.far = camera.position.z + 10;
        }
        emberU.uFocus.value = camera.position.z;
        emberU.uPx.value = renderer.getPixelRatio() * ch * 0.5;
        emberU.uFadeY.value = narrow ? 0.32 : 0;
        shared.uGrain.value = narrow ? 0.025 : 0.035;
        // two tickets on a phone, the front one a little smaller
        tickets[2].t.visible = !narrow;
        frontTicket.p.s = narrow ? 0.9 : 1;
      };

      const draw = (ms: number, dt: number) => {
        shared.uTime.value = ms / 1000;
        const sec = ms / 1000;
        // the pointer: eased toward the mouse, or parked; the lamp follows it, with a glint sweeping across on load and every 8 s without a mouse
        const c = cursor?.current;
        const mouse = !still && !!c?.on && fine;
        if (mouse && c) {
          if (!eased.on) {
            eased.x = c.x;
            eased.y = c.y;
          }
          eased.x += (c.x - eased.x) * 0.14;
          eased.y += (c.y - eased.y) * 0.14;
        }
        eased.on = mouse;
        if (!mouse && ms > 4000 && ms - state.glintAt > 8000) state.glintAt = ms;
        const gl = ms - state.glintAt;
        if (gl >= 0 && gl < 900) {
          const k = gl / 900;
          lamp.position.set(lerp(-3, 3, k), 0.4 + Math.sin(k * Math.PI) * 0.6, 2.6);
          lamp.intensity = 40 * Math.sin(k * Math.PI) + 8;
        } else if (mouse) {
          const p = aim(eased.x, eased.y);
          if (p) lamp.position.set(p.x, p.y, 2.6);
          lamp.intensity = 32;
        } else {
          lamp.position.lerp(point.set(1.2, 1.4, 2.6), 0.05);
          lamp.intensity = lerp(lamp.intensity, 16, 0.05);
        }
        emberU.uLamp.value.copy(lamp.position);
        emberU.uIn.value = still ? 1 : expo((ms - 400) / 1800);

        // scroll: the tickets drift up like lanterns as the hero is left
        const box = section?.getBoundingClientRect();
        const sp = box ? clamp01(-box.top / Math.max(1, box.height)) : 0;
        group.position.y = sp * 1.6;
        group.rotation.z = sp * 0.15;
        emberU.uTime.value = still ? 7.3 : sec * (1 + sp);

        const lean = mouse ? { x: (eased.x / Math.max(1, innerWidth) - 0.5) * 2, y: (eased.y / Math.max(1, innerHeight) - 0.5) * 2 } : { x: 0, y: 0 };
        tickets.forEach((tk, n) => {
          const e = still ? 1 : expo((ms - tk.p.delay) / 1400);
          const p = tk.p;
          const i = n * 2.1 + sec * 0.6;
          tk.t.position.set(p.x + lean.x * 0.25 * p.s, p.y + (1 - e) * -5 + Math.sin(i) * 0.1 - lean.y * 0.12, p.z);
          tk.t.rotation.set((1 - e) * -0.7 + Math.sin(i * 0.8) * 0.08 + lean.y * 0.3, p.ry + lean.x * 0.45 + Math.cos(i * 0.7) * 0.1, p.rz + Math.sin(i * 0.5) * 0.05);
          tk.t.scale.setScalar(p.s * lerp(0.85, 1, e));
        });

        // the stub: hinges a little under a hovering mouse, tears off when clicked and grows back
        const s = state.stub;
        const hinge = frontTicket.hinge;
        if (s.phase === "on") {
          s.hover += ((overStub ? 0.18 : 0) - s.hover) * Math.min(1, dt * 9);
          hinge.rotation.set(0, 0, s.hover);
          hinge.position.set(cut, 0, 0);
          hinge.scale.setScalar(1);
        } else if (s.phase === "gone") {
          const k = (performance.now() - s.at) / 1000;
          s.v.y -= 9 * dt;
          hinge.position.addScaledVector(s.v, dt);
          hinge.rotation.x += s.w.x * dt;
          hinge.rotation.y += s.w.y * dt;
          hinge.rotation.z += s.w.z * dt;
          if (k > 0.9) hinge.visible = false;
          if (k > 1.1) {
            s.phase = "back";
            s.at = performance.now();
            hinge.visible = true;
            hinge.position.set(cut, 0, 0);
            hinge.rotation.set(0, 0, 0);
            hinge.scale.setScalar(0);
          }
        } else {
          const k = (performance.now() - s.at) / 500;
          hinge.scale.setScalar(expo(k));
          if (k >= 1) s.phase = "on";
        }
        const at = sparkGeo.attributes.position as InstanceType<typeof THREE.BufferAttribute>;
        const al = sparkGeo.attributes.aA as InstanceType<typeof THREE.BufferAttribute>;
        for (let i = 0; i < sparkN; i++) {
          if (sparkLife[i] <= 0) {
            al.setX(i, 0);
            continue;
          }
          sparkLife[i] -= dt * 1.1;
          sparkV[i].y -= 2.2 * dt;
          at.setXYZ(i, at.getX(i) + sparkV[i].x * dt, at.getY(i) + sparkV[i].y * dt, at.getZ(i) + sparkV[i].z * dt);
          al.setX(i, Math.max(0, sparkLife[i]));
        }
        at.needsUpdate = al.needsUpdate = true;
        renderer.render(scene, camera);
      };

      let visible = true;
      let raf = 0;
      let last = 0;
      const dts: number[] = [];
      let slow = 0;
      let frames = 0;
      const frame = (now: number) => {
        raf = 0;
        const delta = last ? now - last : 16;
        const dt = Math.min(0.05, delta / 1000);
        last = now;
        draw(now - state.t0, dt);
        // the frame time is watched: after a warm-up, two slow windows in a row step the quality down (fewer embers and 1x, then no embers)
        if (++frames > 30) {
          dts.push(delta);
          if (dts.length > 45) dts.shift();
          if (dts.length === 45) {
            const median = [...dts].sort((a, b) => a - b)[22];
            slow = median > Math.max(20, 1.8 * 16.7) ? slow + 1 : 0;
            if (slow >= 45 && quality.emberTier < 2) {
              quality.emberTier++;
              if (quality.emberTier === 1) {
                renderer.setPixelRatio(1);
                emberGeo.setDrawRange(0, Math.floor(emberCount * 0.6));
              } else emberGeo.setDrawRange(0, 0);
              slow = 0;
              dts.length = 0;
              size();
            }
          }
        }
        if (visible && !document.hidden && !still) raf = requestAnimationFrame(frame);
      };
      const wake = () => {
        if (!raf && visible && !document.hidden) {
          last = 0;
          raf = requestAnimationFrame(frame);
        }
      };
      const resize = new ResizeObserver(() => {
        size();
        if (state.t0) draw(performance.now() - state.t0, 0.016);
      });
      resize.observe(el);
      const view = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) wake();
      });
      view.observe(el);
      size();
      try {
        // compile the clear-coat and film shaders before the first frame, so the rise does not stall on it
        await renderer.compileAsync(scene, camera);
      } catch {
        /* the first frame compiles them instead */
      }
      const lost = (e: Event) => {
        e.preventDefault();
        cancelAnimationFrame(raf);
        el.hidden = true;
      };
      el.addEventListener("webglcontextlost", lost);
      stop = () => {
        cancelAnimationFrame(raf);
        resize.disconnect();
        view.disconnect();
        document.removeEventListener("visibilitychange", wake);
        section?.removeEventListener("pointerdown", onDown);
        section?.removeEventListener("pointermove", onHover);
        section?.classList.remove("cursor-pointer");
        el.removeEventListener("webglcontextlost", lost);
        for (const d of disposables) d.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      };
      if (gone) {
        stop();
        return;
      }
      state.t0 = performance.now();
      el.style.opacity = "1";
      if (still) {
        draw(7300, 0.016);
      } else {
        document.addEventListener("visibilitychange", wake);
        section?.addEventListener("pointerdown", onDown);
        section?.addEventListener("pointermove", onHover, { passive: true });
        wake();
      }
    });

    return () => {
      gone = true;
      stop();
    };
  }, [cursor]);

  // the canvas fades in once it has drawn its first frame (the transition is in the class); it never takes the pointer, the section listens instead
  return <canvas ref={canvas} aria-hidden style={{ opacity: 0 }} className={className} />;
}
