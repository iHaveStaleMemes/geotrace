// --- APP STATE ---
    const STATE = {
      image: null,
      scaleMeterPerPx: 0.50, // 1 px = 0.50 meters

      // Transform variables
      zoom: 1.0,
      pan: { x: 0, y: 0 },
      rotation: 0.0, // Radians

      // Dragging states
      isRightDragging: false,
      rightDragMode: null, // 'pan' or 'rotate'
      lastMouse: { x: 0, y: 0 },

      // Drawing tool mode
      tool: 'rect', // 'rect', 'poly', 'select'
      shapes: [],
      selectedShapeId: null,

      // Rectangle drawing state (screen coordinates)
      isDrawingRect: false,
      rectStartScreen: null, // {x, y}
      rectEndScreen: null,   // {x, y}
      rectSkewScreen: 0,

      // Polygon drawing state (image coordinates)
      polyPoints: [],

      // Pending modal shape
      pendingShape: null,

      // Pending delete target
      pendingDeleteId: null,

      // Inline renaming target
      editingShapeId: null,

      // Multi-selected layout IDs (for bulk operations)
      checkedShapeIds: new Set()
    };

    // --- UNDO / REDO STACKS ---
    const undoStack = [];
    const redoStack = [];

    function pushUndoSnapshot() {
      // Push deep clone of shapes to undo stack
      undoStack.push(JSON.parse(JSON.stringify(STATE.shapes)));
      if (undoStack.length > 50) undoStack.shift();
      redoStack.length = 0; // Clear redo history on new action
      updateUndoRedoButtons();
    }

    function updateUndoRedoButtons() {
      const btnUndo = document.getElementById('btn-undo');
      const btnRedo = document.getElementById('btn-redo');
      if (btnUndo) {
        btnUndo.disabled = (undoStack.length === 0 && STATE.polyPoints.length === 0 && !STATE.isDrawingRect);
      }
      if (btnRedo) {
        btnRedo.disabled = (redoStack.length === 0);
      }
    }

    // Instant Undo without confirmation
    function undoLast() {
      if (STATE.polyPoints.length > 0) {
        STATE.polyPoints.pop();
        render();
        updateUndoRedoButtons();
        showToast('Point removed');
        return;
      }
      if (STATE.isDrawingRect) {
        STATE.isDrawingRect = false;
        STATE.rectStartScreen = null;
        render();
        updateUndoRedoButtons();
        showToast('Drawing cancelled');
        return;
      }
      if (undoStack.length > 0) {
        // Push current shapes to redo stack
        redoStack.push(JSON.parse(JSON.stringify(STATE.shapes)));
        // Pop previous shapes from undo stack
        STATE.shapes = undoStack.pop();
        STATE.checkedShapeIds.clear();
        if (!STATE.shapes.find(s => s.id === STATE.selectedShapeId)) {
          STATE.selectedShapeId = null;
        }
        render();
        updateLayersList();
        updateUndoRedoButtons();
        if (STATE.selectedShapeId) {
          inspectShape(STATE.shapes.find(s => s.id === STATE.selectedShapeId));
        } else {
          document.getElementById('inspector-content').innerHTML = '<div>Select or draw a layout to view dimensions.</div>';
        }
        showToast('↶ Action Undone');
      }
    }

    // Instant Redo without confirmation (Ctrl+Shift+Z or Ctrl+Y)
    function redoLast() {
      if (redoStack.length > 0) {
        // Push current shapes to undo stack
        undoStack.push(JSON.parse(JSON.stringify(STATE.shapes)));
        // Pop from redo stack
        STATE.shapes = redoStack.pop();
        STATE.checkedShapeIds.clear();
        if (!STATE.shapes.find(s => s.id === STATE.selectedShapeId)) {
          STATE.selectedShapeId = null;
        }
        render();
        updateLayersList();
        updateUndoRedoButtons();
        if (STATE.selectedShapeId) {
          inspectShape(STATE.shapes.find(s => s.id === STATE.selectedShapeId));
        } else {
          document.getElementById('inspector-content').innerHTML = '<div>Select or draw a layout to view dimensions.</div>';
        }
        showToast('↷ Action Redone');
      }
    }

    // Toast notification helper
    let toastTimer = null;
    function showToast(msg) {
      const toast = document.getElementById('toast');
      if (!toast) return;
      toast.innerText = msg;
      toast.classList.remove('opacity-0', 'pointer-events-none');
      toast.classList.add('opacity-100');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.remove('opacity-100');
        toast.classList.add('opacity-0', 'pointer-events-none');
      }, 1600);
    }

    // --- THEME MANAGEMENT (Dark theme default) ---
    function initTheme() {
      const saved = localStorage.getItem('tracer-theme') || 'dark';
      applyTheme(saved);
    }

    function applyTheme(theme) {
      const html = document.documentElement;
      const btn = document.getElementById('btn-theme-toggle');
      if (theme === 'light') {
        html.classList.remove('dark');
        html.classList.add('light');
        if (btn) btn.innerHTML = '☀️ Light';
        localStorage.setItem('tracer-theme', 'light');
      } else {
        html.classList.remove('light');
        html.classList.add('dark');
        if (btn) btn.innerHTML = '🌙 Dark';
        localStorage.setItem('tracer-theme', 'dark');
      }
      render();
    }

    function toggleTheme() {
      const isDark = document.documentElement.classList.contains('dark');
      applyTheme(isDark ? 'light' : 'dark');
    }

    document.getElementById('btn-theme-toggle').addEventListener('click', toggleTheme);

    const PRESET_COLORS = [
      '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899',
      '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#14b8a6', '#0f172a'
    ];
    let activeModalColor = PRESET_COLORS[0];

    const canvas = document.getElementById('main-canvas');
    const ctx = canvas.getContext('2d');
    const canvasWrapper = document.getElementById('canvas-wrapper');

    // Resize canvas to match display container
    function resizeCanvas() {
      const rect = canvasWrapper.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      render();
    }
    window.addEventListener('resize', resizeCanvas);

    // Reset view (fit to screen, center pan, 0 rotation)
    function resetView() {
      if (!STATE.image) return;
      const dpr = window.devicePixelRatio || 1;
      const vW = canvas.width / dpr;
      const vH = canvas.height / dpr;

      const scaleX = (vW - 60) / STATE.image.width;
      const scaleY = (vH - 60) / STATE.image.height;
      STATE.zoom = Math.min(1.0, Math.min(scaleX, scaleY));
      STATE.pan = { x: 0, y: 0 };
      STATE.rotation = 0.0;
      updateHud();
      render();
    }

    function setRotationDegrees(deg) {
      STATE.rotation = (deg * Math.PI) / 180;
      updateHud();
      render();
    }

    document.getElementById('btn-rot-0').addEventListener('click', () => setRotationDegrees(0));
    document.getElementById('btn-rot-30').addEventListener('click', () => setRotationDegrees(30));
    document.getElementById('btn-rot-45').addEventListener('click', () => setRotationDegrees(45));
    document.getElementById('btn-rot-90').addEventListener('click', () => setRotationDegrees(90));
    document.getElementById('btn-reset-view').addEventListener('click', resetView);

    // --- 2D COORDINATE AFFINE TRANSFORMATION MATHEMATICS ---
    // Screen (canvas client) coords to underlying Image (pixel) coords
    function screenToImage(sx, sy) {
      if (!STATE.image) return { x: 0, y: 0 };
      const dpr = window.devicePixelRatio || 1;
      const Vcx = (canvas.width / dpr) / 2;
      const Vcy = (canvas.height / dpr) / 2;

      // 1. Un-translate viewport center & pan
      const dx = (sx - (Vcx + STATE.pan.x)) / STATE.zoom;
      const dy = (sy - (Vcy + STATE.pan.y)) / STATE.zoom;

      // 2. Un-rotate
      const cosA = Math.cos(-STATE.rotation);
      const sinA = Math.sin(-STATE.rotation);
      const rx = dx * cosA - dy * sinA;
      const ry = dx * sinA + dy * cosA;

      // 3. Un-center image
      return {
        x: rx + STATE.image.width / 2,
        y: ry + STATE.image.height / 2
      };
    }

    // Underlying Image (pixel) coords to Screen (canvas client) coords
    function imageToScreen(ix, iy) {
      if (!STATE.image) return { x: 0, y: 0 };
      const dpr = window.devicePixelRatio || 1;
      const Vcx = (canvas.width / dpr) / 2;
      const Vcy = (canvas.height / dpr) / 2;

      // 1. Relative to image center
      const rx = ix - STATE.image.width / 2;
      const ry = iy - STATE.image.height / 2;

      // 2. Rotate
      const cosA = Math.cos(STATE.rotation);
      const sinA = Math.sin(STATE.rotation);
      const rxRot = rx * cosA - ry * sinA;
      const ryRot = rx * sinA + ry * cosA;

      // 3. Scale & translate
      return {
        x: Vcx + STATE.pan.x + rxRot * STATE.zoom,
        y: Vcy + STATE.pan.y + ryRot * STATE.zoom
      };
    }

    function hexToRgba(hex, alpha) {
      const clean = hex.replace('#', '');
      const r = parseInt(clean.substring(0, 2), 16) || 0;
      const g = parseInt(clean.substring(2, 4), 16) || 0;
      const b = parseInt(clean.substring(4, 6), 16) || 0;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // Helper: calculate centroid of polygon
    function getPolygonCentroid(points) {
      if (!points || points.length === 0) return { x: 0, y: 0 };
      let cx = 0, cy = 0;
      for (let i = 0; i < points.length; i++) {
        cx += points[i].x;
        cy += points[i].y;
      }
      return { x: cx / points.length, y: cy / points.length };
    }

    // --- CANVAS DRAWING / RENDERING ---
    function render() {
      const dpr = window.devicePixelRatio || 1;
      const isDark = document.documentElement.classList.contains('dark');
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Background architectural drafting canvas
      ctx.fillStyle = isDark ? '#060a14' : '#f1f5f9';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Set scale for high-DPI displays
      ctx.scale(dpr, dpr);

      if (!STATE.image) {
        // Draw elegant empty state drop zone
        const Vcx = (canvas.width / dpr) / 2;
        const Vcy = (canvas.height / dpr) / 2;
        const boxW = Math.min(480, (canvas.width / dpr) - 60);
        const boxH = 220;

        ctx.save();
        ctx.fillStyle = isDark ? '#0f172a' : '#ffffff';
        ctx.strokeStyle = isDark ? '#3b82f6' : '#0f172a';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 6]);
        roundRect(ctx, Vcx - boxW/2, Vcy - boxH/2, boxW, boxH, 16, true, true);
        ctx.setLineDash([]);

        ctx.fillStyle = isDark ? '#60a5fa' : '#0f172a';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🖼️', Vcx, Vcy - 45);

        ctx.font = 'bold 16px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
        ctx.fillText('No Image Loaded', Vcx, Vcy + 2);

        ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
        ctx.fillText('Click anywhere here or "📁 Load Photo" to choose an image', Vcx, Vcy + 28);
        ctx.fillText('or Drag & Drop any photo / satellite map directly onto this window', Vcx, Vcy + 48);
        ctx.restore();

        ctx.restore();
        return;
      }

      const Vcx = (canvas.width / dpr) / 2;
      const Vcy = (canvas.height / dpr) / 2;

      // Apply World View Transform: Pan -> Rotate -> Zoom
      ctx.save();
      ctx.translate(Vcx + STATE.pan.x, Vcy + STATE.pan.y);
      ctx.rotate(STATE.rotation);
      ctx.scale(STATE.zoom, STATE.zoom);

      // 1. Draw Image centered
      const imgW = STATE.image.width;
      const imgH = STATE.image.height;
      ctx.drawImage(STATE.image, -imgW / 2, -imgH / 2, imgW, imgH);

      // Fine image boundary stroke
      ctx.strokeStyle = isDark ? '#475569' : '#0f172a';
      ctx.lineWidth = 1.5 / STATE.zoom;
      ctx.strokeRect(-imgW / 2, -imgH / 2, imgW, imgH);

      // 2. Draw all Finished Shapes (in image coordinate space)
      STATE.shapes.forEach(shape => {
        if (!shape.visible || !shape.points || shape.points.length < 3) return;

        ctx.save();
        ctx.beginPath();
        const p0 = shape.points[0];
        ctx.moveTo(p0.x - imgW/2, p0.y - imgH/2);
        for (let i = 1; i < shape.points.length; i++) {
          const pt = shape.points[i];
          ctx.lineTo(pt.x - imgW/2, pt.y - imgH/2);
        }
        ctx.closePath();

        // Inside semi-transparent overlay
        ctx.fillStyle = hexToRgba(shape.color, shape.opacity || 0.35);
        ctx.fill();

        // Crisp solid border of the exact chosen color
        ctx.strokeStyle = shape.color;
        const isSel = (shape.id === STATE.selectedShapeId);
        ctx.lineWidth = (isSel ? 3.5 : 2.5) / STATE.zoom;
        ctx.stroke();

        ctx.restore();
      });

      // 3. Draw In-Progress Polygon lines
      if (STATE.polyPoints.length > 0) {
        ctx.save();
        ctx.beginPath();
        const p0 = STATE.polyPoints[0];
        ctx.moveTo(p0.x - imgW/2, p0.y - imgH/2);
        for (let i = 1; i < STATE.polyPoints.length; i++) {
          const pt = STATE.polyPoints[i];
          ctx.lineTo(pt.x - imgW/2, pt.y - imgH/2);
        }

        ctx.strokeStyle = activeModalColor;
        ctx.lineWidth = 2.5 / STATE.zoom;
        ctx.stroke();

        // Draw vertex dots
        STATE.polyPoints.forEach((pt, idx) => {
          ctx.beginPath();
          ctx.arc(pt.x - imgW/2, pt.y - imgH/2, 4.5 / STATE.zoom, 0, Math.PI * 2);
          ctx.fillStyle = (idx === 0) ? '#22c55e' : '#3b82f6';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5 / STATE.zoom;
          ctx.stroke();
        });
        ctx.restore();
      }

      ctx.restore(); // Restore image space

      // 4. Draw In-Progress Rectangle Preview (in screen coordinates)
      if (STATE.isDrawingRect && STATE.rectStartScreen && STATE.rectEndScreen) {
        ctx.save();
        const polyScreen = computeRectPolygonScreen(STATE.rectStartScreen, STATE.rectEndScreen, STATE.rectSkewScreen);
        ctx.beginPath();
        ctx.moveTo(polyScreen[0].x, polyScreen[0].y);
        for (let i = 1; i < polyScreen.length; i++) {
          ctx.lineTo(polyScreen[i].x, polyScreen[i].y);
        }
        ctx.closePath();

        ctx.fillStyle = hexToRgba(activeModalColor, 0.30);
        ctx.fill();

        ctx.strokeStyle = activeModalColor;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw 4 corner handles
        polyScreen.forEach((pt, idx) => {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = (idx === 0) ? '#10b981' : '#ffffff';
          ctx.fill();
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 2;
          ctx.stroke();
        });
        ctx.restore();
      }

      // 5. Draw Visible Name Labels on top of footprints (Screen Space)
      STATE.shapes.forEach(shape => {
        if (!shape.visible || !shape.showName || !shape.points || shape.points.length < 3) return;

        const c = getPolygonCentroid(shape.points);
        const sPos = imageToScreen(c.x, c.y);

        ctx.save();
        ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
        const nameText = shape.name || 'Layout';
        const textMetrics = ctx.measureText(nameText);
        const padX = 7;
        const pillW = textMetrics.width + padX * 2 + 12;
        const pillH = 22;
        const pillX = sPos.x - pillW / 2;
        const pillY = sPos.y - pillH / 2;

        // Shadow for maximum contrast over satellite maps
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 1.5;

        // Background pill
        ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.95)';
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = 1.5;
        roundRect(ctx, pillX, pillY, pillW, pillH, 6, true, true);

        // Turn off shadow for crisp text
        ctx.shadowColor = 'transparent';

        // Colored Pip
        ctx.beginPath();
        ctx.arc(pillX + padX + 3.5, sPos.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = shape.color;
        ctx.fill();

        // Name text
        ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(nameText, pillX + padX + 11, sPos.y);

        ctx.restore();
      });

      ctx.restore();
    }

    // Helper: round rect
    function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      if (fill) ctx.fill();
      if (stroke) ctx.stroke();
    }

    // Compute 4 corners of rectangle / parallelogram in screen coords
    function computeRectPolygonScreen(start, end, skew) {
      const p1 = { x: start.x, y: start.y };
      const p2 = { x: end.x + skew, y: start.y };
      const p3 = { x: end.x, y: end.y };
      const p4 = { x: start.x - skew, y: end.y };
      return [p1, p2, p3, p4];
    }

    function updateHud() {
      const deg = ((STATE.rotation * 180) / Math.PI) % 360;
      const normalizedDeg = (deg < 0 ? deg + 360 : deg).toFixed(1);
      document.getElementById('hud-rot').innerText = `${normalizedDeg}°`;
      document.getElementById('overlay-angle-text').innerText = `${normalizedDeg}°`;
      document.getElementById('hud-zoom').innerText = `${Math.round(STATE.zoom * 100)}%`;
    }

    // --- INTERACTION & EVENT HANDLERS ---
    // Prevent default browser right-click menu on canvas
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('mousedown', e => {
      // If no image is loaded, clicking triggers image picker
      if (!STATE.image && e.button === 0) {
        document.getElementById('file-upload').click();
        return;
      }

      // 1. RIGHT-CLICK: Navigation (Pan / Rotate / Reset)
      if (e.button === 2) {
        e.preventDefault();

        // Ctrl + Double Right-Click: Reset Rotation to 0°
        if (e.ctrlKey && e.detail === 2) {
          STATE.rotation = 0.0;
          updateHud();
          render();
          showToast('Rotation reset to 0°');
          return;
        }

        STATE.isRightDragging = true;
        STATE.lastMouse = { x: e.clientX, y: e.clientY };

        if (e.ctrlKey) {
          STATE.rightDragMode = 'rotate';
          document.getElementById('rotate-hint-overlay').classList.remove('hidden');
        } else {
          STATE.rightDragMode = 'pan';
        }
        return;
      }

      // 2. LEFT-CLICK: Drawing Shapes or Selecting
      if (e.button !== 0) return;

      const rect = canvas.getBoundingClientRect();
      const sPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const imgPos = screenToImage(sPos.x, sPos.y);

      // MULTI-POINT CORNER MODE (When Ctrl is held OR tool is 'poly')
      if (e.ctrlKey || STATE.tool === 'poly') {
        // Check if clicking near start point to close
        if (STATE.polyPoints.length >= 3) {
          const startPt = STATE.polyPoints[0];
          const distPx = Math.hypot(imgPos.x - startPt.x, imgPos.y - startPt.y);
          if (distPx < (18 / STATE.zoom)) {
            // SNAP & FINISH SHAPE!
            openStyleModal([...STATE.polyPoints]);
            STATE.polyPoints = [];
            render();
            updateUndoRedoButtons();
            return;
          }
        }

        // Add corner
        STATE.polyPoints.push(imgPos);
        document.getElementById('status-mode-text').innerText = `Polygon: ${STATE.polyPoints.length} points (Click green start point to close)`;
        render();
        updateUndoRedoButtons();
        return;
      }

      // RECTANGLE / PARALLELOGRAM MODE
      if (STATE.tool === 'rect') {
        if (!STATE.isDrawingRect) {
          // First corner clicked
          STATE.isDrawingRect = true;
          STATE.rectStartScreen = sPos;
          STATE.rectEndScreen = sPos;
          STATE.rectSkewScreen = 0;
          document.getElementById('status-mode-text').innerText = 'Click opposite corner (Hold Shift for parallelogram skew)';
        } else {
          // Second corner clicked -> COMPLETE RECTANGLE!
          STATE.isDrawingRect = false;
          STATE.rectEndScreen = sPos;
          if (e.shiftKey) {
            STATE.rectSkewScreen = Math.round((sPos.x - STATE.rectStartScreen.x) * 0.45);
          }
          const polyScreen = computeRectPolygonScreen(STATE.rectStartScreen, STATE.rectEndScreen, STATE.rectSkewScreen);
          // Convert 4 screen corners to image coordinates so the box is permanent on the map!
          const polyImage = polyScreen.map(pt => screenToImage(pt.x, pt.y));

          STATE.rectStartScreen = null;
          STATE.rectEndScreen = null;
          STATE.rectSkewScreen = 0;

          openStyleModal(polyImage);
          document.getElementById('status-mode-text').innerText = 'Click Corner 1 to start rectangle (Shift = Parallelogram)';
          render();
        }
        return;
      }

      // SELECT TOOL
      if (STATE.tool === 'select') {
        selectShapeAtPoint(imgPos);
      }
    });

    window.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      const sPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const imgPos = screenToImage(sPos.x, sPos.y);

      document.getElementById('hud-coords').innerText = `${Math.round(imgPos.x)}, ${Math.round(imgPos.y)}`;

      // 1. Right-Click Dragging: Pan or Rotate
      if (STATE.isRightDragging) {
        const deltaX = e.clientX - STATE.lastMouse.x;
        const deltaY = e.clientY - STATE.lastMouse.y;
        STATE.lastMouse = { x: e.clientX, y: e.clientY };

        if (STATE.rightDragMode === 'rotate' || e.ctrlKey) {
          STATE.rotation += deltaY * 0.007;
          updateHud();
          render();
        } else {
          STATE.pan.x += deltaX;
          STATE.pan.y += deltaY;
          render();
        }
        return;
      }

      // 2. Drawing Rectangle Preview
      if (STATE.isDrawingRect && STATE.rectStartScreen) {
        STATE.rectEndScreen = sPos;
        if (e.shiftKey) {
          STATE.rectSkewScreen = Math.round((sPos.x - STATE.rectStartScreen.x) * 0.45);
        } else {
          STATE.rectSkewScreen = 0;
        }
        render();
        updateInspectorPreview(sPos);
      }

      // 3. Polygon snap cursor cue
      if (STATE.polyPoints.length >= 3) {
        const startPt = STATE.polyPoints[0];
        const distPx = Math.hypot(imgPos.x - startPt.x, imgPos.y - startPt.y);
        if (distPx < (18 / STATE.zoom)) {
          canvas.style.cursor = 'cell';
          document.getElementById('status-mode-text').innerText = '🟢 Click start point to CLOSE shape!';
        } else {
          canvas.style.cursor = 'crosshair';
        }
      }
    });

    window.addEventListener('mouseup', e => {
      if (e.button === 2 || STATE.isRightDragging) {
        STATE.isRightDragging = false;
        STATE.rightDragMode = null;
        document.getElementById('rotate-hint-overlay').classList.add('hidden');
      }
    });

    // --- SMOOTH WHEEL ZOOMING TOWARDS MOUSE CURSOR ---
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (!STATE.image) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const Mx = e.clientX - rect.left;
      const My = e.clientY - rect.top;
      const Vcx = (canvas.width / dpr) / 2;
      const Vcy = (canvas.height / dpr) / 2;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const newZoom = Math.max(0.1, Math.min(15.0, STATE.zoom * zoomFactor));
      const ratio = newZoom / STATE.zoom;

      STATE.pan.x = (STATE.pan.x * ratio) + (Mx - Vcx) * (1 - ratio);
      STATE.pan.y = (STATE.pan.y * ratio) + (My - Vcy) * (1 - ratio);
      STATE.zoom = newZoom;

      updateHud();
      render();
    }, { passive: false });

    // --- KEYBOARD SHORTCUTS ---
    // Note: Enter / Return NEVER deletes layouts.
    // Backspace NEVER deletes layouts.
    // Delete key triggers a confirmation modal.
    // Ctrl+Z (Undo) and Ctrl+Shift+Z / Ctrl+Y (Redo) execute immediately with NO confirmation.
    window.addEventListener('keydown', e => {
      // Don't intercept shortcuts when editing inside text inputs (e.g., naming layout or scale)
      if (e.target && e.target.tagName === 'INPUT') {
        if (e.key === 'Escape') {
          if (STATE.editingShapeId) {
            STATE.editingShapeId = null;
            updateLayersList();
            return;
          }
          closeStyleModal();
          closeDeleteModal();
        }
        return;
      }

      // REDO: Ctrl+Shift+Z, Cmd+Shift+Z, or Ctrl+Y (No confirmation)
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey) ||
          ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        redoLast();
        return;
      }

      // UNDO: Ctrl+Z or Cmd+Z without Shift (No confirmation)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoLast();
        return;
      }

      // ESCAPE: Close modals or cancel current drawing
      if (e.key === 'Escape') {
        if (!document.getElementById('delete-modal').classList.contains('hidden')) {
          closeDeleteModal();
          return;
        }
        if (!document.getElementById('style-modal').classList.contains('hidden')) {
          closeStyleModal();
          return;
        }
        STATE.isDrawingRect = false;
        STATE.rectStartScreen = null;
        STATE.polyPoints = [];
        render();
        updateUndoRedoButtons();
        document.getElementById('status-mode-text').innerText = 'Cancelled current drawing';
        return;
      }

      // DELETE KEY: Only explicit Delete key initiates layout deletion, and requires confirmation!
      // Backspace and Enter/Return are strictly ignored for deletion.
      if (e.key === 'Delete') {
        if (STATE.selectedShapeId) {
          promptDeleteShape(STATE.selectedShapeId);
        }
      }
    });

    document.getElementById('btn-undo').addEventListener('click', undoLast);
    document.getElementById('btn-redo').addEventListener('click', redoLast);

    // --- COLOR & STYLE MODAL ---
    function openStyleModal(imagePoints) {
      STATE.pendingShape = {
        id: 'shape_' + Date.now(),
        name: `Layout ${STATE.shapes.length + 1}`,
        points: imagePoints,
        color: activeModalColor,
        opacity: parseFloat(document.getElementById('modal-opacity-slider').value) / 100,
        visible: true,
        showName: false // by default invisible
      };

      document.getElementById('modal-name-input').value = STATE.pendingShape.name;
      document.getElementById('modal-show-name').checked = false;
      document.getElementById('style-modal').classList.remove('hidden');
      setTimeout(() => {
        document.getElementById('modal-name-input').focus();
        document.getElementById('modal-name-input').select();
      }, 50);
    }

    function closeStyleModal() {
      STATE.pendingShape = null;
      document.getElementById('style-modal').classList.add('hidden');
      render();
    }

    // Palette swatch generation
    const paletteGrid = document.getElementById('preset-colors-grid');
    PRESET_COLORS.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'w-9 h-9 rounded-lg border-2 border-[var(--card-border)] shadow-[1.5px_1.5px_0px_var(--card-shadow)] hover:scale-105 transition';
      btn.style.backgroundColor = c;
      btn.addEventListener('click', () => {
        activeModalColor = c;
        document.getElementById('modal-custom-color').value = c;
        document.getElementById('modal-hex-val').innerText = c.toUpperCase();
        highlightActivePreset();
      });
      paletteGrid.appendChild(btn);
    });

    function highlightActivePreset() {
      Array.from(paletteGrid.children).forEach(btn => {
        btn.classList.toggle('ring-4', btn.style.backgroundColor === activeModalColor);
        btn.classList.toggle('ring-blue-500', btn.style.backgroundColor === activeModalColor);
      });
    }

    document.getElementById('modal-custom-color').addEventListener('input', e => {
      activeModalColor = e.target.value;
      document.getElementById('modal-hex-val').innerText = activeModalColor.toUpperCase();
      highlightActivePreset();
    });

    document.getElementById('modal-opacity-slider').addEventListener('input', e => {
      document.getElementById('modal-opacity-val').innerText = e.target.value + '%';
    });

    document.getElementById('btn-modal-confirm').addEventListener('click', confirmShapeStyle);
    document.getElementById('modal-name-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') confirmShapeStyle();
    });

    function confirmShapeStyle() {
      if (!STATE.pendingShape) return;
      STATE.pendingShape.name = document.getElementById('modal-name-input').value || `Layout ${STATE.shapes.length + 1}`;
      STATE.pendingShape.color = activeModalColor;
      STATE.pendingShape.opacity = parseInt(document.getElementById('modal-opacity-slider').value, 10) / 100;
      STATE.pendingShape.showName = document.getElementById('modal-show-name').checked;

      // Save state for undo before mutating
      pushUndoSnapshot();

      STATE.shapes.push(STATE.pendingShape);
      STATE.selectedShapeId = STATE.pendingShape.id;
      STATE.pendingShape = null;

      document.getElementById('style-modal').classList.add('hidden');
      render();
      updateLayersList();
      updateUndoRedoButtons();
      inspectShape(STATE.shapes[STATE.shapes.length - 1]);
      showToast('Layout added');
    }

    document.getElementById('btn-modal-cancel').addEventListener('click', closeStyleModal);

    // --- DELETE CONFIRMATION MODAL & ACTIONS ---
    function promptDeleteShape(id) {
      const shape = STATE.shapes.find(s => s.id === id);
      if (!shape) return;
      STATE.pendingDeleteId = id;
      document.getElementById('delete-modal-shape-name').innerText = `"${shape.name}"`;
      document.getElementById('delete-modal').classList.remove('hidden');
      document.getElementById('btn-delete-cancel').focus();
    }

    function closeDeleteModal() {
      STATE.pendingDeleteId = null;
      document.getElementById('delete-modal').classList.add('hidden');
    }

    function executeDeleteShape(id) {
      if (!id) return;
      // Record undo snapshot prior to deletion
      pushUndoSnapshot();

      STATE.shapes = STATE.shapes.filter(s => s.id !== id);
      if (STATE.selectedShapeId === id) STATE.selectedShapeId = null;
      closeDeleteModal();
      render();
      updateLayersList();
      updateUndoRedoButtons();
      document.getElementById('inspector-content').innerHTML = '<div>Select or draw a layout to view dimensions.</div>';
      showToast('Layout deleted (Ctrl+Z to undo)');
    }

    document.getElementById('btn-delete-cancel').addEventListener('click', closeDeleteModal);
    document.getElementById('btn-delete-confirm').addEventListener('click', () => {
      executeDeleteShape(STATE.pendingDeleteId);
    });

    // --- LAYERS LIST & BULK MANAGEMENT ---
    function updateLayersList() {
      const list = document.getElementById('layers-list');
      const count = document.getElementById('layer-count');
      count.innerText = STATE.shapes.length;

      // Clean up checkedShapeIds for shapes that were deleted
      STATE.checkedShapeIds = new Set([...STATE.checkedShapeIds].filter(id => STATE.shapes.some(s => s.id === id)));

      // Update Bulk Actions Bar visibility and counts
      const bulkBar = document.getElementById('bulk-actions-bar');
      const bulkCount = document.getElementById('bulk-count');
      const badge = document.getElementById('selected-count-badge');
      const chkSelectAll = document.getElementById('chk-select-all');

      const checkedCount = STATE.checkedShapeIds.size;
      if (checkedCount > 0) {
        bulkBar.classList.remove('hidden');
        bulkCount.innerText = checkedCount;
        badge.classList.remove('hidden');
        badge.innerText = `${checkedCount} sel`;
      } else {
        bulkBar.classList.add('hidden');
        badge.classList.add('hidden');
      }

      if (chkSelectAll) {
        chkSelectAll.checked = (STATE.shapes.length > 0 && checkedCount === STATE.shapes.length);
        chkSelectAll.indeterminate = (checkedCount > 0 && checkedCount < STATE.shapes.length);
      }

      // Update toggle all names button text
      const allNamesBtnText = document.getElementById('toggle-all-names-text');
      if (allNamesBtnText) {
        const allOn = (STATE.shapes.length > 0 && STATE.shapes.every(s => s.showName));
        allNamesBtnText.innerText = allOn ? 'Hide All' : 'Show All';
      }

      if (STATE.shapes.length === 0) {
        list.innerHTML = '<div class="text-[var(--text-muted)] italic text-[11px] p-2 text-center">No shapes created yet. Draw a rectangle or polygon!</div>';
        return;
      }

      list.innerHTML = '';
      STATE.shapes.slice().reverse().forEach(shape => {
        const item = document.createElement('div');
        const isSel = shape.id === STATE.selectedShapeId;
        const isChecked = STATE.checkedShapeIds.has(shape.id);
        const isEditing = shape.id === STATE.editingShapeId;

        if (isEditing) {
          item.className = 'p-1.5 rounded-lg border-2 border-blue-500 bg-[var(--card-bg)] flex items-center justify-between gap-1 shadow-[2px_2px_0px_var(--card-shadow)]';
          item.innerHTML = `
            <div class="flex items-center gap-1.5 flex-1 min-w-0">
              <span class="w-3.5 h-3.5 rounded-full border border-white/40 shrink-0" style="background-color: ${shape.color}"></span>
              <input type="text" class="rename-input w-full px-1.5 py-0.5 text-xs font-bold bg-[var(--input-bg)] border border-blue-400 rounded text-[var(--text-main)] outline-none focus:ring-1 focus:ring-blue-400" value="${shape.name}">
            </div>
            <div class="flex items-center gap-0.5 shrink-0">
              <button class="btn-save-rename p-1 text-xs text-emerald-400 hover:text-emerald-300 font-bold" title="Save Name (Enter)">✓</button>
              <button class="btn-cancel-rename p-1 text-xs text-slate-400 hover:text-slate-200" title="Cancel (Esc)">✕</button>
            </div>
          `;

          const input = item.querySelector('.rename-input');
          const saveBtn = item.querySelector('.btn-save-rename');
          const cancelBtn = item.querySelector('.btn-cancel-rename');

          const saveRename = () => {
            const val = input.value.trim();
            if (val && val !== shape.name) {
              pushUndoSnapshot();
              shape.name = val;
              showToast(`Renamed to "${shape.name}"`);
            }
            STATE.editingShapeId = null;
            render();
            updateLayersList();
            if (STATE.selectedShapeId === shape.id) inspectShape(shape);
          };

          const cancelRename = () => {
            STATE.editingShapeId = null;
            updateLayersList();
          };

          saveBtn.addEventListener('click', saveRename);
          cancelBtn.addEventListener('click', cancelRename);

          input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              saveRename();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelRename();
            }
          });

          setTimeout(() => {
            input.focus();
            input.select();
          }, 30);

        } else {
          item.className = `p-2 rounded-lg border-2 border-[var(--card-border)] flex items-center justify-between gap-1.5 shadow-[2px_2px_0px_var(--card-shadow)] transition cursor-pointer ${
            isSel ? 'bg-blue-600 text-white border-blue-400 font-bold' : (isChecked ? 'bg-blue-950/40 border-blue-500/50 text-[var(--text-main)]' : 'bg-[var(--card-bg)] hover:bg-[var(--btn-bg)] text-[var(--text-main)]')
          }`;

          item.innerHTML = `
            <div class="flex items-center gap-1.5 overflow-hidden flex-1 min-w-0">
              <input type="checkbox" class="shape-checkbox w-3.5 h-3.5 rounded accent-blue-600 shrink-0 cursor-pointer" ${isChecked ? 'checked' : ''} title="Select for bulk actions">
              
              <!-- Recolor Interactive Swatch -->
              <label class="relative w-4 h-4 shrink-0 cursor-pointer flex items-center justify-center group" title="Click to recolor this layout">
                <span class="block w-3.5 h-3.5 rounded-full border border-white/50 shadow-sm transition group-hover:scale-125" style="background-color: ${shape.color}"></span>
                <input type="color" class="shape-color-input absolute inset-0 opacity-0 w-full h-full cursor-pointer" value="${shape.color}">
              </label>

              <span class="shape-title font-bold truncate text-xs flex-1" title="Double-click to rename">${shape.name}</span>
            </div>

            <!-- Action buttons: [🏷️ label] [👁️ vis] [✏️ rename] [🗑️ delete] -->
            <div class="flex items-center gap-0.5 shrink-0">
              <button class="btn-toggle-label p-1 text-xs rounded transition hover:opacity-85 ${shape.showName ? 'text-amber-400 bg-amber-500/20 font-bold' : 'text-slate-400 hover:text-slate-200'}" title="${shape.showName ? 'Hide name in drawing' : 'Show name in drawing'}">
                🏷️
              </button>
              <button class="btn-toggle-vis p-1 hover:opacity-75 text-xs" title="Toggle Visibility">
                ${shape.visible ? '👁️' : '🕶️'}
              </button>
              <button class="btn-rename p-1 hover:opacity-75 text-xs text-blue-300" title="Rename Layout">
                ✏️
              </button>
              <button class="btn-del p-1 hover:opacity-75 text-xs text-red-400" title="Delete Layout (Requires confirmation)">
                🗑️
              </button>
            </div>
          `;

          item.addEventListener('click', e => {
            if (e.target.closest('button') || e.target.closest('input') || e.target.closest('label')) return;
            STATE.selectedShapeId = shape.id;
            render();
            updateLayersList();
            inspectShape(shape);
          });

          // Checkbox toggle
          const chk = item.querySelector('.shape-checkbox');
          chk.addEventListener('change', e => {
            e.stopPropagation();
            if (e.target.checked) {
              STATE.checkedShapeIds.add(shape.id);
            } else {
              STATE.checkedShapeIds.delete(shape.id);
            }
            updateLayersList();
          });

          // Interactive Color Swatch Recolor
          const colorInput = item.querySelector('.shape-color-input');
          colorInput.addEventListener('input', e => {
            e.stopPropagation();
            pushUndoSnapshot();
            shape.color = e.target.value;
            render();
            updateLayersList();
            if (STATE.selectedShapeId === shape.id) inspectShape(shape);
            showToast(`Recolored "${shape.name}" to ${shape.color.toUpperCase()}`);
          });

          // Toggle Label on canvas
          item.querySelector('.btn-toggle-label').addEventListener('click', e => {
            e.stopPropagation();
            pushUndoSnapshot();
            shape.showName = !shape.showName;
            render();
            updateLayersList();
            showToast(shape.showName ? `Showing "${shape.name}" on canvas` : `Hidden "${shape.name}" name`);
          });

          // Double click title to rename
          item.querySelector('.shape-title').addEventListener('dblclick', e => {
            e.stopPropagation();
            STATE.editingShapeId = shape.id;
            updateLayersList();
          });

          // Toggle visibility
          item.querySelector('.btn-toggle-vis').addEventListener('click', e => {
            e.stopPropagation();
            shape.visible = !shape.visible;
            render();
            updateLayersList();
          });

          // Rename
          item.querySelector('.btn-rename').addEventListener('click', e => {
            e.stopPropagation();
            STATE.editingShapeId = shape.id;
            updateLayersList();
          });

          // Delete
          item.querySelector('.btn-del').addEventListener('click', e => {
            e.stopPropagation();
            promptDeleteShape(shape.id);
          });
        }

        list.appendChild(item);
      });
    }

    // --- BULK ACTION LISTENERS ---
    const chkSelectAll = document.getElementById('chk-select-all');
    if (chkSelectAll) {
      chkSelectAll.addEventListener('change', e => {
        if (e.target.checked) {
          STATE.shapes.forEach(s => STATE.checkedShapeIds.add(s.id));
        } else {
          STATE.checkedShapeIds.clear();
        }
        updateLayersList();
      });
    }

    // Toggle All Names (Canvas Labels)
    document.getElementById('btn-toggle-all-names').addEventListener('click', () => {
      if (STATE.shapes.length === 0) return;
      const anyOff = STATE.shapes.some(s => !s.showName);
      pushUndoSnapshot();
      STATE.shapes.forEach(s => s.showName = anyOff);
      render();
      updateLayersList();
      showToast(anyOff ? 'All layout names shown on canvas' : 'All layout names hidden on canvas');
    });

    // Toggle All Visibility
    document.getElementById('btn-toggle-all-vis').addEventListener('click', () => {
      if (STATE.shapes.length === 0) return;
      const anyHidden = STATE.shapes.some(s => !s.visible);
      STATE.shapes.forEach(s => s.visible = anyHidden);
      render();
      updateLayersList();
      showToast(anyHidden ? 'All layouts visible' : 'All layouts hidden');
    });

    // Bulk Show Names (for selected layouts)
    document.getElementById('btn-bulk-show-names').addEventListener('click', () => {
      if (STATE.checkedShapeIds.size === 0) return;
      pushUndoSnapshot();
      STATE.shapes.forEach(s => {
        if (STATE.checkedShapeIds.has(s.id)) s.showName = true;
      });
      render();
      updateLayersList();
      showToast(`Names shown for ${STATE.checkedShapeIds.size} selected layout(s)`);
    });

    // Bulk Hide Names (for selected layouts)
    document.getElementById('btn-bulk-hide-names').addEventListener('click', () => {
      if (STATE.checkedShapeIds.size === 0) return;
      pushUndoSnapshot();
      STATE.shapes.forEach(s => {
        if (STATE.checkedShapeIds.has(s.id)) s.showName = false;
      });
      render();
      updateLayersList();
      showToast(`Names hidden for ${STATE.checkedShapeIds.size} selected layout(s)`);
    });

    // Bulk Recolor (for selected layouts)
    document.getElementById('bulk-color-picker').addEventListener('input', e => {
      if (STATE.checkedShapeIds.size === 0) return;
      const newColor = e.target.value;
      pushUndoSnapshot();
      STATE.shapes.forEach(s => {
        if (STATE.checkedShapeIds.has(s.id)) s.color = newColor;
      });
      render();
      updateLayersList();
      showToast(`Recolored ${STATE.checkedShapeIds.size} layouts to ${newColor.toUpperCase()}`);
    });

    // Bulk Delete (for selected layouts)
    document.getElementById('btn-bulk-delete').addEventListener('click', () => {
      const count = STATE.checkedShapeIds.size;
      if (count === 0) return;
      if (confirm(`Are you sure you want to delete ${count} selected layout(s)? (You can undo with Ctrl+Z)`)) {
        pushUndoSnapshot();
        STATE.shapes = STATE.shapes.filter(s => !STATE.checkedShapeIds.has(s.id));
        if (STATE.checkedShapeIds.has(STATE.selectedShapeId)) STATE.selectedShapeId = null;
        STATE.checkedShapeIds.clear();
        render();
        updateLayersList();
        updateUndoRedoButtons();
        showToast(`Deleted ${count} layouts`);
      }
    });

    function inspectShape(shape) {
      if (!shape || !shape.points) return;
      const box = document.getElementById('inspector-content');

      let perimeterPx = 0;
      for (let i = 0; i < shape.points.length; i++) {
        const pA = shape.points[i];
        const pB = shape.points[(i + 1) % shape.points.length];
        perimeterPx += Math.hypot(pB.x - pA.x, pB.y - pA.y);
      }
      const perimeterM = (perimeterPx * STATE.scaleMeterPerPx).toFixed(1);

      // Shoelace area formula
      let areaPx = 0;
      for (let i = 0; i < shape.points.length; i++) {
        const pA = shape.points[i];
        const pB = shape.points[(i + 1) % shape.points.length];
        areaPx += (pA.x * pB.y - pB.x * pA.y);
      }
      areaPx = Math.abs(areaPx) / 2;
      const areaM2 = (areaPx * STATE.scaleMeterPerPx * STATE.scaleMeterPerPx).toFixed(1);

      box.innerHTML = `
        <div class="font-bold text-[var(--text-main)]">${shape.name}</div>
        <div>Perimeter: <strong class="text-blue-400">${perimeterM} m</strong> (${Math.round(perimeterPx)} px)</div>
        <div>Footprint Area: <strong class="text-emerald-400">${areaM2} m²</strong></div>
        <div>Border Color: <strong style="color:${shape.color}">${shape.color}</strong></div>
        <div>Opacity: <strong>${Math.round(shape.opacity * 100)}%</strong></div>
      `;
    }

    function updateInspectorPreview(currScreen) {
      if (!STATE.rectStartScreen || !STATE.rectEndScreen) return;
      const box = document.getElementById('inspector-content');
      const wPx = Math.abs(currScreen.x - STATE.rectStartScreen.x) / STATE.zoom;
      const hPx = Math.abs(currScreen.y - STATE.rectStartScreen.y) / STATE.zoom;
      const wM = (wPx * STATE.scaleMeterPerPx).toFixed(1);
      const hM = (hPx * STATE.scaleMeterPerPx).toFixed(1);

      box.innerHTML = `
        <div class="font-bold text-[var(--text-main)]">Drawing Rectangle...</div>
        <div>Width: <strong>${wM} m</strong> (${Math.round(wPx)} px)</div>
        <div>Height: <strong>${hM} m</strong> (${Math.round(hPx)} px)</div>
        ${STATE.rectSkewScreen ? `<div>Parallelogram Skew: <strong>${((STATE.rectSkewScreen / STATE.zoom) * STATE.scaleMeterPerPx).toFixed(1)} m</strong></div>` : ''}
      `;
    }

    function selectShapeAtPoint(pt) {
      for (let i = STATE.shapes.length - 1; i >= 0; i--) {
        const s = STATE.shapes[i];
        if (pointInPolygon(pt, s.points)) {
          STATE.selectedShapeId = s.id;
          render();
          updateLayersList();
          inspectShape(s);
          return;
        }
      }
      STATE.selectedShapeId = null;
      render();
      updateLayersList();
    }

    function pointInPolygon(pt, poly) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
                          (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }

    // --- TOOL SWITCHER BUTTONS ---
    const toolRect = document.getElementById('tool-rect');
    const toolPoly = document.getElementById('tool-poly');
    const toolSelect = document.getElementById('tool-select');

    function setTool(t) {
      STATE.tool = t;
      [toolRect, toolPoly, toolSelect].forEach(btn => btn.classList.remove('active'));
      if (t === 'rect') {
        toolRect.classList.add('active');
        document.getElementById('status-mode-text').innerText = 'Click Corner 1 to start rectangle (Shift = Parallelogram)';
      } else if (t === 'poly') {
        toolPoly.classList.add('active');
        document.getElementById('status-mode-text').innerText = 'Mode: Multi-Point Polygon (Click corner after corner)';
      } else if (t === 'select') {
        toolSelect.classList.add('active');
        document.getElementById('status-mode-text').innerText = 'Mode: Select & Inspect Layout';
      }
    }

    toolRect.addEventListener('click', () => setTool('rect'));
    toolPoly.addEventListener('click', () => setTool('poly'));
    toolSelect.addEventListener('click', () => setTool('select'));

    document.getElementById('scale-input').addEventListener('input', e => {
      STATE.scaleMeterPerPx = parseFloat(e.target.value) || 0.50;
      if (STATE.selectedShapeId) {
        const s = STATE.shapes.find(x => x.id === STATE.selectedShapeId);
        if (s) inspectShape(s);
      }
    });

    // File Upload / Replacement
    document.getElementById('file-upload').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          STATE.image = img;
          resizeCanvas();
          resetView();
          document.getElementById('status-mode-text').innerText = 'Image loaded. Ready to trace!';
          showToast('Image loaded');
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });

    // Drag and Drop Image directly onto Canvas Window
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = ev => {
          const img = new Image();
          img.onload = () => {
            STATE.image = img;
            resizeCanvas();
            resetView();
            document.getElementById('status-mode-text').innerText = 'Image loaded. Ready to trace!';
            showToast('Image loaded');
          };
          img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      }
    });

    // Clear All
    document.getElementById('btn-clear-all').addEventListener('click', () => {
      if (STATE.shapes.length === 0) return;
      if (confirm('Are you sure you want to clear all drawn layouts? (You can still undo with Ctrl+Z)')) {
        pushUndoSnapshot();
        STATE.shapes = [];
        STATE.selectedShapeId = null;
        updateLayersList();
        updateUndoRedoButtons();
        render();
        showToast('All layouts cleared');
      }
    });

    // --- EXPORTS ---
    document.getElementById('btn-export-png').addEventListener('click', () => {
      if (!STATE.image) return;
      const expCanvas = document.createElement('canvas');
      expCanvas.width = STATE.image.width;
      expCanvas.height = STATE.image.height;
      const expCtx = expCanvas.getContext('2d');
      expCtx.drawImage(STATE.image, 0, 0);

      STATE.shapes.forEach(shape => {
        if (!shape.visible || !shape.points || shape.points.length < 3) return;
        expCtx.beginPath();
        expCtx.moveTo(shape.points[0].x, shape.points[0].y);
        for (let i = 1; i < shape.points.length; i++) expCtx.lineTo(shape.points[i].x, shape.points[i].y);
        expCtx.closePath();

        expCtx.fillStyle = hexToRgba(shape.color, shape.opacity || 0.35);
        expCtx.fill();
        expCtx.strokeStyle = shape.color;
        expCtx.lineWidth = 3;
        expCtx.stroke();
      });

      // Draw name labels on exported PNG if showName is active
      STATE.shapes.forEach(shape => {
        if (!shape.visible || !shape.showName || !shape.points || shape.points.length < 3) return;
        const c = getPolygonCentroid(shape.points);
        expCtx.save();
        expCtx.font = 'bold 16px "Plus Jakarta Sans", sans-serif';
        const textMetrics = expCtx.measureText(shape.name);
        const padX = 10, pillH = 30;
        const pillW = textMetrics.width + padX * 2 + 16;
        const pillX = c.x - pillW / 2;
        const pillY = c.y - pillH / 2;

        expCtx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        expCtx.strokeStyle = shape.color;
        expCtx.lineWidth = 2.5;
        roundRect(expCtx, pillX, pillY, pillW, pillH, 8, true, true);

        // Colored Pip
        expCtx.beginPath();
        expCtx.arc(pillX + padX + 5, c.y, 5, 0, Math.PI * 2);
        expCtx.fillStyle = shape.color;
        expCtx.fill();

        expCtx.fillStyle = '#ffffff';
        expCtx.textAlign = 'left';
        expCtx.textBaseline = 'middle';
        expCtx.fillText(shape.name, pillX + padX + 16, c.y);
        expCtx.restore();
      });

      const link = document.createElement('a');
      link.download = 'layout_overlay.png';
      link.href = expCanvas.toDataURL('image/png');
      link.click();
    });

    document.getElementById('btn-export-svg').addEventListener('click', () => {
      if (!STATE.image) return;
      let svg = `<?xml version="1.0" standalone="no"?>\n`;
      svg += `<svg width="${STATE.image.width}" height="${STATE.image.height}" xmlns="http://www.w3.org/2000/svg">\n`;
      
      STATE.shapes.forEach(s => {
        const ptsStr = s.points.map(p => `${p.x},${p.y}`).join(' ');
        svg += `  <polygon points="${ptsStr}" fill="${s.color}" fill-opacity="${s.opacity || 0.35}" stroke="${s.color}" stroke-width="2.5" id="${s.name}" />\n`;
        if (s.showName && s.points && s.points.length >= 3) {
          const c = getPolygonCentroid(s.points);
          svg += `  <text x="${c.x}" y="${c.y}" font-family="sans-serif" font-size="14" font-weight="bold" fill="#ffffff" stroke="#0f172a" stroke-width="3" paint-order="stroke fill" text-anchor="middle" dominant-baseline="central">${s.name}</text>\n`;
        }
      });
      svg += `</svg>`;

      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = 'layout_blueprint.svg';
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById('btn-export-json').addEventListener('click', () => {
      if (!STATE.image) return;
      const cx = STATE.image.width / 2;
      const cy = STATE.image.height / 2;
      const data = STATE.shapes.map(s => {
        const meters = s.points.map(pt => ({
          x: +((pt.x - cx) * STATE.scaleMeterPerPx).toFixed(2),
          z: +((pt.y - cy) * STATE.scaleMeterPerPx).toFixed(2)
        }));
        return {
          id: s.id,
          name: s.name,
          color: s.color,
          opacity: s.opacity,
          showName: s.showName || false,
          pixelCoordinates: s.points,
          metersCoordinatesCentered: meters
        };
      });

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = 'layouts.json';
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    });

    // Initialize Theme and Canvas sizing
    initTheme();
    resizeCanvas();
    updateUndoRedoButtons();
