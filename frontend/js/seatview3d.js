/* ═══════════════════════════════════════════════════════════════
   CineVault — 3D "view from your seat" preview.

   Self-contained ES module; the page loads it with
   <script type="module">, so it never blocks the classic scripts.
   Everything geometric is derived from the seat map the seats page
   already fetched — the backend knows rows × seats-per-row and we
   dress that grid in standard auditorium dimensions (see GEO; one
   day these could become optional Hall columns, the defaults are
   honest averages).

   API, all optional to call and safe to call repeatedly:
     CV_SeatView.init(cfg)      build the scene once per seat map
     CV_SeatView.update(state)  repaint selection/taken, fly the camera
   If WebGL is unavailable init() removes the panel and quietly exits.
   ═══════════════════════════════════════════════════════════════ */
import * as THREE from './vendor/three.module.min.js';

(function () {
  'use strict';

  /* Auditorium construction constants (metres). The seat map stores
     only row/number; these dress that grid in typical cinema fabric. */
  var GEO = {
    seatW: 0.60,            // seat width
    margin: 1.4,            // wall to outermost seat, each side
    aisleW: 0.9,            // extra gap when the 2D plan splits a row
    rowPitch: 1.15,         // distance between rows, front to back
    rakeStep: 0.19,         // each row this much higher
    frontRowDist: 4.0,      // screen to row 1
    screenBottom: 1.5,      // screen lower edge
    screenRatio: 2.39,      // scope screen
    eyeH: 1.12,             // seated eye height above local floor
  };

  var C_SEAT   = 0x40121c;  // house velvet
  var C_SEAT_T = 0x262630;  // taken
  var C_SEAT_S = 0xe8c04a;  // selected — brand accent
  var C_FLOOR  = 0x1a1726;
  var C_WALL   = 0x151317;
  var C_CEIL   = 0x0d0c12;

  var built = null;   // { renderer, scene, camera, parts… }

  function seatWorld(row, num, hall) {
    var aisle = hall.aisleAfter && num > hall.aisleAfter ? GEO.aisleW : 0;
    return {
      x: -hall.span / 2 + GEO.margin + GEO.seatW / 2 + (num - 1) * GEO.seatW + aisle,
      y: GEO.rakeStep * (row - 1) + GEO.eyeH,
      z: GEO.frontRowDist + (row - 1) * GEO.rowPitch
    };
  }

  function buildScene(cfg) {
    var hall = cfg.hall;
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: cfg.canvas, antialias: true });
    } catch (e) { return null; }

    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a12);
    scene.fog = new THREE.Fog(0x0a0a12, 14, 30);

    var camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 100);

    var floorY = function (row) { return GEO.rakeStep * (row - 1); };
    var backZ = GEO.frontRowDist + (hall.rows - 1) * GEO.rowPitch + 1.6;
    var midZ = backZ / 2, runLen = backZ + 2, rise = GEO.rakeStep * hall.rows;
    var slope = Math.atan2(GEO.rakeStep, GEO.rowPitch);
    var CEIL = cfg.screenTop + 1.6;

    function slab(w, h, d, x, y, z, color, rx) {
      var m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshLambertMaterial({ color: color }));
      m.position.set(x, y, z);
      if (rx) m.rotation.x = rx;
      scene.add(m);
      return m;
    }

    /* raked floor under the seats, flat strip in front of row 1 */
    slab(hall.span + 2, 0.3, runLen + 3, 0, rise / 2 - 0.35, midZ, C_FLOOR, -slope);
    slab(hall.span + 2, 0.3, GEO.frontRowDist + 2, 0, -0.35, GEO.frontRowDist / 2 - 1, C_FLOOR);
    /* box of the room */
    slab(0.3, CEIL, runLen + 4, -hall.span / 2 - 1.2, CEIL / 2, midZ, C_WALL);
    slab(0.3, CEIL, runLen + 4,  hall.span / 2 + 1.2, CEIL / 2, midZ, C_WALL);
    slab(hall.span + 3, 0.3, runLen + 4, 0, CEIL + 0.15, midZ, C_CEIL);
    slab(hall.span + 3, CEIL - cfg.screenTop, 0.3, 0, (CEIL + cfg.screenTop) / 2, -0.4, C_WALL);
    var pierW = hall.span / 2.3 + 1.1;
    slab(pierW, CEIL, 0.3, -hall.span / 2 - pierW / 2 + 0.1, CEIL / 2, -0.4, C_WALL);
    slab(pierW, CEIL, 0.3,  hall.span / 2 + pierW / 2 - 0.1, CEIL / 2, -0.4, C_WALL);
    /* back wall, so look-behind is a wall and not the void */
    slab(hall.span + 3, CEIL, 0.3, 0, CEIL / 2, backZ + 0.6, C_WALL);

    /* ── the screen: the movie's own key art if we have it ── */
    var screen = new THREE.Mesh(
      new THREE.PlaneGeometry(cfg.screenW, cfg.screenH),
      new THREE.MeshBasicMaterial({ color: 0x000000 }));
    screen.position.set(0, GEO.screenBottom + cfg.screenH / 2, 0);
    scene.add(screen);

    if (cfg.backdropUrl) {
      new THREE.TextureLoader().load(cfg.backdropUrl, function (tex) {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        /* cover-fit whatever aspect the art arrives in onto scope ratio */
        var imgAspect = tex.image.width / tex.image.height;
        if (imgAspect < GEO.screenRatio) {
          tex.repeat.set(1, imgAspect / GEO.screenRatio);
          tex.offset.set(0, (1 - imgAspect / GEO.screenRatio) / 2);
        } else {
          tex.repeat.set(GEO.screenRatio / imgAspect, 1);
          tex.offset.set((1 - GEO.screenRatio / imgAspect) / 2, 0);
        }
        screen.material.map = tex;
        screen.material.color.set(0xffffff);
        screen.material.needsUpdate = true;
      }, undefined, function () { paintFallback(screen); });
    } else {
      paintFallback(screen);
    }

    /* projection glow — additive sprite hugging the screen */
    var glowCv = document.createElement('canvas');
    glowCv.width = glowCv.height = 256;
    var gx = glowCv.getContext('2d');
    var grd = gx.createRadialGradient(128, 128, 20, 128, 128, 128);
    grd.addColorStop(0, 'rgba(190,170,255,.55)');
    grd.addColorStop(0.5, 'rgba(140,110,220,.18)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    gx.fillStyle = grd; gx.fillRect(0, 0, 256, 256);
    var glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(glowCv),
      blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0.9
    }));
    glow.scale.set(cfg.screenW + 5, cfg.screenH + 3, 1);
    glow.position.set(0, GEO.screenBottom + cfg.screenH / 2, -0.1);
    scene.add(glow);

    /* ── light: the screen is the lamp ── */
    var lamp = new THREE.PointLight(0xfff0dd, 1.15, 0, 0.9);
    lamp.position.set(0, GEO.screenBottom + cfg.screenH / 2, 1.2);
    scene.add(lamp);
    scene.add(new THREE.AmbientLight(0x8f8fbe, 0.32));

    /* ── seats: 4 instanced box parts, recoloured per instance ── */
    var seatGeoSlots = {};
    [
      ['base',     [0.52, 0.10, 0.48], [0, 0.46, 0], 0],
      ['back',     [0.52, 0.62, 0.10], [0, 0.72, 0.26], -0.12],
      ['armLeft',  [0.06, 0.24, 0.44], [-0.30, 0.58, 0], 0],
      ['armRight', [0.06, 0.24, 0.44], [0.30, 0.58, 0], 0]
    ].forEach(function (part) {
      var name = part[0], size = part[1], off = part[2], tilt = part[3];
      var geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
      var mat = new THREE.MeshLambertMaterial();
      var mesh = new THREE.InstancedMesh(geo, mat, hall.seats.length);
      mesh.userData.off = off; mesh.userData.tilt = tilt;
      scene.add(mesh);
      seatGeoSlots[name] = mesh;
    });

    var dummy = new THREE.Object3D();
    hall.seats.forEach(function (s, i) {
      Object.keys(seatGeoSlots).forEach(function (k) {
        var mesh = seatGeoSlots[k];
        dummy.position.set(s.x + mesh.userData.off[0], floorY(s.row) + 0 + mesh.userData.off[1], s.z + mesh.userData.off[2]);
        dummy.rotation.set(mesh.userData.tilt, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, new THREE.Color(C_SEAT));
      });
    });
    Object.values(seatGeoSlots).forEach(function (m) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });

    return { renderer: renderer, scene: scene, camera: camera, seatGeoSlots: seatGeoSlots, cfg: cfg };
  }

  /* Movie has no usable art: a quiet title card instead of a void. */
  function paintFallback(screen) {
    var c = document.createElement('canvas');
    c.width = 1024; c.height = 428;
    var x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, 428);
    g.addColorStop(0, '#14121f'); g.addColorStop(1, '#2a2540');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 428);
    x.fillStyle = 'rgba(232,192,74,.9)';
    x.font = "400 84px 'Bebas Neue',Impact,sans-serif";
    x.textAlign = 'center';
    x.fillText('C I N E V A U L T', 512, 235);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    screen.material.map = tex;
    screen.material.color.set(0xffffff);
    screen.material.needsUpdate = true;
  }

  /* ── camera rig: fixed head position, free gaze ── */
  var rig = {
    pos: new THREE.Vector3(), target: new THREE.Vector3(),
    lookYaw: 0, lookPitch: 0, focusSeat: null, clock: null
  };

  function baseAngles(p) {
    var s = built.cfg;
    var dx = 0 - p.x, dy = s.screenCentreY - p.y, dz = 0 - p.z;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  }

  function seatByRowNum(row, num) {
    for (var i = 0; i < built.cfg.hall.seats.length; i++) {
      var s = built.cfg.hall.seats[i];
      if (s.row === row && s.number === num) return s;
    }
    return null;
  }

  function retint(selected) {
    var selKeys = {};
    (selected || []).forEach(function (s) { selKeys[s.row + '-' + s.number] = true; });
    var color = new THREE.Color();
    ['base', 'back', 'armLeft', 'armRight'].forEach(function (k) {
      var mesh = built.seatGeoSlots[k];
      built.cfg.hall.seats.forEach(function (s, i) {
        var c = s.taken ? C_SEAT_T : selKeys[s.row + '-' + s.number] ? C_SEAT_S : C_SEAT;
        mesh.setColorAt(i, color.set(c));
      });
      mesh.instanceColor.needsUpdate = true;
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    var b = built; if (!b) return;

    var dt = Math.min((b.clock || (b.clock = new THREE.Clock())).getDelta(), 0.1);
    var k = 1 - Math.exp(-dt * 4.5);
    rig.pos.lerp(rig.target, k);

    var a = baseAngles(rig.pos);
    var yaw = a.yaw + rig.lookYaw, pitch = a.pitch + rig.lookPitch;
    b.camera.position.copy(rig.pos);
    b.camera.lookAt(
      rig.pos.x - Math.sin(yaw) * Math.cos(pitch),
      rig.pos.y + Math.sin(pitch),
      rig.pos.z - Math.cos(yaw) * Math.cos(pitch));

    if (rig.focusSeat && b.hud && rig.pos.distanceTo(rig.target) < 0.05) {
      var dist = Math.hypot(rig.target.x, rig.target.y - (GEO.screenBottom + b.cfg.screenH / 2), rig.target.z);
      var theta = 2 * Math.atan(b.cfg.screenW / (2 * rig.target.z)) * 57.2958;
      b.hud.innerHTML = '<b>Seat ' + rig.focusSeat.label + '</b><br>' +
        dist.toFixed(1) + ' m from screen &nbsp;·&nbsp; screen fills ' +
        Math.min(theta, 120).toFixed(0) + '° of your view';
    }

    var dpr = Math.min(devicePixelRatio, 2);
    var w = b.canvas.clientWidth, h = b.canvas.clientHeight;
    if (b.canvas.width !== (w * dpr | 0) || b.canvas.height !== (h * dpr | 0)) {
      b.renderer.setSize(w, h, false);
      b.camera.aspect = w / h;
      b.camera.updateProjectionMatrix();
    }
    b.renderer.render(b.scene, b.camera);
  }

  window.CV_SeatView = {
    /* cfg: { canvas, hud, hint, seats, hall:{rows,perRow,aisleAfter}, backdropUrl } */
    init: function (cfg) {
      var span = cfg.hall.perRow * GEO.seatW + GEO.margin * 2 + (cfg.hall.aisleAfter ? GEO.aisleW : 0);
      var screenW = Math.max(6, span - 1.4);
      var screenH = screenW / GEO.screenRatio;
      cfg.hall.span = span;
      cfg.screenW = screenW;
      cfg.screenH = screenH;
      cfg.screenTop = GEO.screenBottom + screenH;
      cfg.screenCentreY = GEO.screenBottom + screenH / 2;

      cfg.hall.seats = cfg.seats.map(function (s) {
        var p = seatWorld(s.row, s.number, cfg.hall);
        return {
          row: s.row, number: s.number, label: s.label,
          taken: s.status === 'booked',
          x: p.x, z: p.z
        };
      });

      built = buildScene(cfg);
      if (!built) return false;
      built.canvas = cfg.canvas;
      built.hud = cfg.hud;

      /* park the camera at a centre-ish seat before anyone picks */
      var home = seatByRowNum(Math.ceil(cfg.hall.rows / 2), Math.ceil(cfg.hall.perRow / 2))
              || cfg.hall.seats[0];
      rig.pos.set(home.x, GEO.rakeStep * (home.row - 1) + GEO.eyeH, home.z);
      rig.target.copy(rig.pos);

      /* drag to look around from the seat you are in */
      var dragging = false, px = 0, py = 0, hinted = false;
      cfg.canvas.addEventListener('pointerdown', function (e) {
        dragging = true; px = e.clientX; py = e.clientY;
        cfg.canvas.setPointerCapture(e.pointerId);
        if (!hinted && cfg.hint) { hinted = true; cfg.hint.style.opacity = 0; }
      });
      addEventListener('pointerup', function () { dragging = false; });
      addEventListener('pointermove', function (e) {
        if (!dragging) return;
        rig.lookYaw   = Math.max(-1.35, Math.min(1.35, rig.lookYaw - (e.clientX - px) * 0.004));
        rig.lookPitch = Math.max(-0.85, Math.min(0.85, rig.lookPitch + (e.clientY - py) * 0.004));
        px = e.clientX; py = e.clientY;
      });

      animate();
      return true;
    },

    /* state: { seats?, selected: [{row,number}], focus: {row,number,label}|null } */
    update: function (state) {
      if (!built) return;
      if (state.seats) {
        state.seats.forEach(function (s) {
          var seat = seatByRowNum(s.row, s.number);
          if (seat) seat.taken = s.status === 'booked';
        });
      }
      retint(state.selected);
      if (state.focus) {
        var seat = seatByRowNum(state.focus.row, state.focus.number);
        if (seat) {
          rig.target.set(seat.x, GEO.rakeStep * (seat.row - 1) + GEO.eyeH, seat.z);
          rig.lookYaw = rig.lookPitch = 0;
          rig.focusSeat = { label: state.focus.label || seat.label };
        }
      }
    }
  };

  document.dispatchEvent(new CustomEvent('cv:seatview-ready'));
})();
