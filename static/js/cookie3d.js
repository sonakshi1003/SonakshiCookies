/* 3D cookie hero built with Three.js, using the real product photo
   (static/images/cookie_hero.png, transparent background) as the texture
   on a slightly extruded disc — so it looks like the actual cookie,
   not a procedural stand-in, while keeping genuine 3D interaction. */

(function () {
  const wrap = document.getElementById("cookie-canvas-wrap");
  const canvas = document.getElementById("cookie-canvas");
  if (!wrap || !canvas || typeof THREE === "undefined") return;

  const isMobile = window.innerWidth < 900;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, wrap.clientWidth / wrap.clientHeight, 0.1, 100);
  camera.position.set(0, 0.3, 6.4);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // ---- lighting ----
  const ambient = new THREE.AmbientLight(0xfff1e0, 0.7);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xfff4dd, 1.0);
  key.position.set(3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -3;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xffe8ea, 0.3);
  fill.position.set(-4, 1, 2);
  scene.add(fill);

  const rim = new THREE.PointLight(0xde838d, 0.5, 12);
  rim.position.set(-2, 2, -3);
  scene.add(rim);

  // ---- cookie group (populated once the texture has loaded) ----
  const cookieGroup = new THREE.Group();
  cookieGroup.rotation.x = -0.18;
  scene.add(cookieGroup);

  const RADIUS = 1.9;
  const THICKNESS = 0.32;

  const loader = new THREE.TextureLoader();
  loader.load(
    "/static/images/cookie_hero.png",
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace || texture.colorSpace;
      texture.anisotropy = 4;

      // Cylinder: top cap shows the real cookie photo (its alpha channel is
      // already transparent outside the circular cookie), side + bottom
      // are a warm baked-edge brown so the disc still reads as "thick".
      const geo = new THREE.CylinderGeometry(RADIUS, RADIUS * 0.97, THICKNESS, 64, 1, false);

      const topMat = new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.3,
        roughness: 0.75,
        metalness: 0,
      });
      const edgeMat = new THREE.MeshStandardMaterial({ color: 0xb5783f, roughness: 0.9, metalness: 0 });
      const bottomMat = new THREE.MeshStandardMaterial({ color: 0x8a5a30, roughness: 0.9, metalness: 0 });

      const cookieMesh = new THREE.Mesh(geo, [edgeMat, topMat, bottomMat]);
      // The cylinder's top cap normal points along +Y (straight up) by default,
      // which only shows its thin edge to a camera positioned in front along +Z.
      // Rotate the mesh 90° so the textured face points toward the camera instead.
      cookieMesh.rotation.x = Math.PI / 2;
      cookieMesh.castShadow = true;
      cookieMesh.receiveShadow = true;
      cookieGroup.add(cookieMesh);
    },
    undefined,
    () => {
      // fallback if the image fails to load: plain warm disc, no texture
      const geo = new THREE.CylinderGeometry(RADIUS, RADIUS * 0.97, THICKNESS, 64);
      const mat = new THREE.MeshStandardMaterial({ color: 0xb5783f, roughness: 0.85 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.castShadow = true;
      cookieGroup.add(mesh);
    }
  );

  // soft contact shadow via a shadow-catcher plane
  const shadowGeo = new THREE.PlaneGeometry(7, 7);
  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.16 });
  const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = -THICKNESS / 2 - 0.7;
  shadowPlane.receiveShadow = true;
  scene.add(shadowPlane);

  // ---- interaction state ----
  let mouseX = 0, mouseY = 0;
  let targetRotX = cookieGroup.rotation.x;
  let targetRotY = 0;
  let scrollFactor = 0;
  let shopTransition = 0;

  window.addEventListener("mousemove", (e) => {
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseY = (e.clientY / window.innerHeight) * 2 - 1;
  });

  window.addEventListener("scroll", () => {
    const heroHeight = wrap.parentElement.offsetHeight || 600;
    scrollFactor = Math.min(window.scrollY / heroHeight, 1.4);
  });

  function triggerShopTransition() {
    const start = performance.now();
    const duration = 900;
    function stepAnim(t) {
      const elapsed = t - start;
      const p = Math.min(elapsed / duration, 1);
      shopTransition = p;
      if (p < 1) requestAnimationFrame(stepAnim);
    }
    requestAnimationFrame(stepAnim);
  }
  window.triggerCookieShopTransition = triggerShopTransition;

  // ---- render loop ----
  let t0 = performance.now();
  function animate(t) {
    requestAnimationFrame(animate);
    const elapsed = (t - t0) / 1000;

    const idleRotY = elapsed * 0.22;

    targetRotY += ((idleRotY + mouseX * 0.3) - targetRotY) * 0.04;
    targetRotX += ((-0.18 + mouseY * 0.12) - targetRotX) * 0.04;

    const scrollRotBoost = scrollFactor * 0.9;
    const scrollScale = 1 - scrollFactor * 0.1;
    const scrollTranslateX = scrollFactor * 0.5;

    const shopScale = 1 - shopTransition * 0.32;
    const shopTranslateX = shopTransition * 1.9;
    const shopRotBoost = shopTransition * 2.0;

    cookieGroup.rotation.y = targetRotY + scrollRotBoost + shopRotBoost;
    cookieGroup.rotation.x = targetRotX;
    cookieGroup.position.x = scrollTranslateX + shopTranslateX;
    cookieGroup.position.y = Math.sin(elapsed * 1.0) * 0.09;
    const s = scrollScale * shopScale;
    cookieGroup.scale.set(s, s, s);

    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);

  // ---- resize ----
  window.addEventListener("resize", () => {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
})();
