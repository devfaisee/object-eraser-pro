// -------------------------------------------------------------
// AI Object Eraser Pro - Core Controller & WebAssembly Engine
// -------------------------------------------------------------

// Active State
const state = {
  originalImage: null,
  imageName: "photo.jpg",
  origWidth: 0,
  origHeight: 0,
  dispWidth: 0,
  dispHeight: 0,
  brushSize: 25,
  brushMode: "draw", // draw, erase
  algorithm: "telea", // telea, ns
  radius: 5,
  isDrawing: false,
  lastX: 0,
  lastY: 0,
  strokeHistory: [], // Array of strokes for Undo: { mode, size, points: [{x, y}, ...] }
  currentStroke: null
};

// DOM References
let elLoader, elProgressBar, elLoaderStatus;
let elDropZone, elFileInput, elThumbnail, elImgName, elImgDims, elBtnRemove;
let elBrushSizeSlider, elBrushSizeVal, elBtnModeDraw, elBtnModeErase;
let elBtnClearMask, elBtnUndo;
let elAlgorithmSelect, elInpaintRadiusSlider, elInpaintRadiusVal;
let elViewport, elPlaceholder, elLayersContainer;
let elImageCanvas, elDrawingCanvas, elHiddenSourceCanvas, elHiddenMaskCanvas;
let elBtnErase, elBtnDownload, elEngineStatus;
let elProcessingOverlay;

// Initialize app on load
document.addEventListener("DOMContentLoaded", () => {
  cacheDomElements();
  initOpenCvLoader();
  bindEventHandlers();
});

function cacheDomElements() {
  elLoader = document.getElementById("engine-loader");
  elProgressBar = document.getElementById("loader-progress");
  elLoaderStatus = document.querySelector(".loader-status");
  
  elDropZone = document.getElementById("drop-zone");
  elFileInput = document.getElementById("file-input");
  elThumbnail = document.getElementById("thumbnail-wrapper");
  elImgName = document.getElementById("img-name");
  elImgDims = document.getElementById("img-dims");
  elBtnRemove = document.getElementById("btn-remove-image");
  
  elBrushSizeSlider = document.getElementById("range-brush-size");
  elBrushSizeVal = document.getElementById("val-brush-size");
  elBtnModeDraw = document.getElementById("btn-mode-draw");
  elBtnModeErase = document.getElementById("btn-mode-erase");
  elBtnClearMask = document.getElementById("btn-clear-mask");
  elBtnUndo = document.getElementById("btn-undo-stroke");
  
  elAlgorithmSelect = document.getElementById("algorithm-select");
  elInpaintRadiusSlider = document.getElementById("range-inpaint-radius");
  elInpaintRadiusVal = document.getElementById("val-inpaint-radius");
  
  elViewport = document.getElementById("editor-viewport");
  elPlaceholder = document.getElementById("editor-placeholder");
  elLayersContainer = document.getElementById("canvas-layers-container");
  
  elImageCanvas = document.getElementById("image-canvas");
  elDrawingCanvas = document.getElementById("drawing-canvas");
  elHiddenSourceCanvas = document.getElementById("hidden-source-canvas");
  elHiddenMaskCanvas = document.getElementById("hidden-mask-canvas");
  
  elBtnErase = document.getElementById("btn-erase");
  elBtnDownload = document.getElementById("btn-download");
  elEngineStatus = document.getElementById("engine-status");
  elProcessingOverlay = document.getElementById("processing-overlay");
}

// --- OpenCV WebAssembly Loader UI ---
function initOpenCvLoader() {
  let progress = 0;
  
  // Smoothly increment loader progress to 90%
  const progressInterval = setInterval(() => {
    if (progress < 90) {
      progress += Math.random() * 8;
      if (progress > 90) progress = 90;
      elProgressBar.style.width = `${progress}%`;
    }
  }, 150);

  function checkOpenCv() {
    if (typeof cv !== "undefined" && cv.Mat) {
      clearInterval(progressInterval);
      elProgressBar.style.width = "100%";
      elLoaderStatus.textContent = "Engine Ready!";
      elEngineStatus.textContent = "Ready (WASM Active)";
      elEngineStatus.style.color = "#10b981";
      
      // Fade out loader screen
      setTimeout(() => {
        elLoader.style.opacity = "0";
        setTimeout(() => {
          elLoader.style.display = "none";
        }, 500);
      }, 300);
    } else {
      setTimeout(checkOpenCv, 100);
    }
  }

  // Handle network/cdn load errors
  const cdnScript = document.getElementById("opencv-cdn");
  cdnScript.onerror = () => {
    clearInterval(progressInterval);
    elLoaderStatus.textContent = "Connection Error!";
    elLoaderStatus.style.color = "#f43f5e";
    alert("Error: Failed to fetch OpenCV WebAssembly modules from CDN. Please check your internet connection.");
  };

  checkOpenCv();
}

// --- Event Handlers & Core Bindings ---
function bindEventHandlers() {
  
  // Drag and Drop Zone
  elDropZone.addEventListener("click", () => elFileInput.click());
  elFileInput.addEventListener("change", handleFileSelect);
  
  elDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    elDropZone.classList.add("dragover");
  });
  
  elDropZone.addEventListener("dragleave", () => {
    elDropZone.classList.remove("dragover");
  });
  
  elDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    elDropZone.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) {
      elFileInput.files = e.dataTransfer.files;
      handleFileSelect();
    }
  });

  elBtnRemove.addEventListener("click", resetImageWorkspace);

  // Brush Controls
  elBrushSizeSlider.addEventListener("input", (e) => {
    state.brushSize = parseInt(e.target.value);
    elBrushSizeVal.textContent = `${state.brushSize}px`;
    drawBrushCursor();
  });

  elBtnModeDraw.addEventListener("click", () => {
    state.brushMode = "draw";
    elBtnModeDraw.classList.add("active");
    elBtnModeErase.classList.remove("active");
  });

  elBtnModeErase.addEventListener("click", () => {
    state.brushMode = "erase";
    elBtnModeErase.classList.add("active");
    elBtnModeDraw.classList.remove("active");
  });

  elBtnClearMask.addEventListener("click", clearActiveMasks);
  elBtnUndo.addEventListener("click", handleUndoStroke);

  // AI Parameters
  elAlgorithmSelect.addEventListener("change", (e) => {
    state.algorithm = e.target.value;
  });

  elInpaintRadiusSlider.addEventListener("input", (e) => {
    state.radius = parseInt(e.target.value);
    elInpaintRadiusVal.textContent = `${state.radius}px`;
  });

  // Editor Drawing Coordinates & mouse actions
  elDrawingCanvas.addEventListener("mousedown", startDrawing);
  elDrawingCanvas.addEventListener("mousemove", drawStroke);
  elDrawingCanvas.addEventListener("mouseup", stopDrawing);
  elDrawingCanvas.addEventListener("mouseleave", stopDrawing);

  // Touch support for tablets/mobiles
  elDrawingCanvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent("mousedown", {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    elDrawingCanvas.dispatchEvent(mouseEvent);
  });

  elDrawingCanvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent("mousemove", {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    elDrawingCanvas.dispatchEvent(mouseEvent);
  });

  elDrawingCanvas.addEventListener("touchend", (e) => {
    e.preventDefault();
    const mouseEvent = new MouseEvent("mouseup", {});
    elDrawingCanvas.dispatchEvent(mouseEvent);
  });

  // Action Buttons
  elBtnErase.addEventListener("click", executeInpaintingPipeline);
  elBtnDownload.addEventListener("click", triggerDownloadCleanImage);
}

// --- Image Load Operations ---
function handleFileSelect() {
  const file = elFileInput.files[0];
  if (!file) return;

  // Verify file is an image
  if (!file.type.startsWith("image/")) {
    alert("Unsupported File: Please choose an image format (PNG, JPG, WebP).");
    return;
  }

  state.imageName = file.name;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      state.originalImage = img;
      setupEditorWorkspace(img);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function setupEditorWorkspace(img) {
  state.origWidth = img.naturalWidth;
  state.origHeight = img.naturalHeight;

  // Max display sizes in editor panel to scale view responsive
  const maxW = elViewport.clientWidth - 32;
  const maxH = elViewport.clientHeight - 32;

  // Calculate downscaled display size retaining aspect ratio
  let w = state.origWidth;
  let h = state.origHeight;
  if (w > maxW) {
    h = (maxW / w) * h;
    w = maxW;
  }
  if (h > maxH) {
    w = (maxH / h) * w;
    h = maxH;
  }

  state.dispWidth = Math.round(w);
  state.dispHeight = Math.round(h);

  // Set sizing parameters for both screen canvases
  elImageCanvas.width = state.dispWidth;
  elImageCanvas.height = state.dispHeight;
  elDrawingCanvas.width = state.dispWidth;
  elDrawingCanvas.height = state.dispHeight;

  // Sizing of hidden original resolution canvases
  elHiddenSourceCanvas.width = state.origWidth;
  elHiddenSourceCanvas.height = state.origHeight;
  elHiddenMaskCanvas.width = state.origWidth;
  elHiddenMaskCanvas.height = state.origHeight;

  // Initialize contexts
  const ctxImg = elImageCanvas.getContext("2d");
  const ctxHiddenSrc = elHiddenSourceCanvas.getContext("2d");
  const ctxHiddenMask = elHiddenMaskCanvas.getContext("2d");

  // Render original image into canvases
  ctxImg.drawImage(img, 0, 0, state.dispWidth, state.dispHeight);
  ctxHiddenSrc.drawImage(img, 0, 0, state.origWidth, state.origHeight);

  // Fill hidden mask with solid black
  ctxHiddenMask.fillStyle = "black";
  ctxHiddenMask.fillRect(0, 0, state.origWidth, state.origHeight);

  // Update UI Elements
  elDropZone.style.display = "none";
  elThumbnail.style.display = "flex";
  elImgName.textContent = state.imageName;
  elImgDims.textContent = `${state.origWidth} x ${state.origHeight} px`;
  
  elPlaceholder.style.display = "none";
  elLayersContainer.style.display = "flex";
  
  document.getElementById("image-status-badge").textContent = "Source Image Loaded";
  document.getElementById("image-status-badge").className = "badge";

  // Reset states
  state.strokeHistory = [];
  elBtnClearMask.disabled = true;
  elBtnUndo.disabled = true;
  elBtnErase.disabled = true;
  elBtnDownload.disabled = false;

  // Clear drawing canvas overlay
  const ctxDraw = elDrawingCanvas.getContext("2d");
  ctxDraw.clearRect(0, 0, state.dispWidth, state.dispHeight);
}

function resetImageWorkspace() {
  state.originalImage = null;
  elFileInput.value = "";
  
  elDropZone.style.display = "flex";
  elThumbnail.style.display = "none";
  
  elPlaceholder.style.display = "flex";
  elLayersContainer.style.display = "none";
  
  document.getElementById("image-status-badge").textContent = "No Image Loaded";
  document.getElementById("image-status-badge").className = "badge";
  
  elBtnErase.disabled = true;
  elBtnDownload.disabled = true;
  elBtnClearMask.disabled = true;
  elBtnUndo.disabled = true;
  
  state.strokeHistory = [];
}

// --- Interactive Canvas Brush Drawing ---
function getMousePos(e) {
  const rect = elDrawingCanvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

function startDrawing(e) {
  if (!state.originalImage) return;
  
  state.isDrawing = true;
  const pos = getMousePos(e);
  state.lastX = pos.x;
  state.lastY = pos.y;
  
  // Create a new stroke record
  state.currentStroke = {
    mode: state.brushMode,
    size: state.brushSize,
    points: [pos]
  };
}

function drawStroke(e) {
  // Always render custom cursor ring follows mouse pointer
  const pos = getMousePos(e);
  drawBrushCursor(pos.x, pos.y);

  if (!state.isDrawing) return;

  // Draw segment
  addStrokeSegment(state.lastX, state.lastY, pos.x, pos.y);
  
  // Save coords
  state.currentStroke.points.push(pos);
  state.lastX = pos.x;
  state.lastY = pos.y;
}

function addStrokeSegment(x1, y1, x2, y2) {
  const ctxDraw = elDrawingCanvas.getContext("2d");
  const ctxMask = elHiddenMaskCanvas.getContext("2d");

  // Coordinate scales matching display to original high resolution
  const scaleX = state.origWidth / state.dispWidth;
  const scaleY = state.origHeight / state.dispHeight;

  // 1. Draw onto display screen overlay canvas
  ctxDraw.lineCap = "round";
  ctxDraw.lineJoin = "round";
  
  if (state.brushMode === "draw") {
    // Semi-transparent glowing rose color for active masking area
    ctxDraw.strokeStyle = "rgba(244, 63, 94, 0.4)";
    ctxDraw.globalCompositeOperation = "source-over";
  } else {
    // Transparent eraser to wipe off drawn paths
    ctxDraw.globalCompositeOperation = "destination-out";
  }
  
  ctxDraw.lineWidth = state.brushSize;
  ctxDraw.beginPath();
  ctxDraw.moveTo(x1, y1);
  ctxDraw.lineTo(x2, y2);
  ctxDraw.stroke();

  // 2. Draw simultaneously onto hidden high-res black-and-white mask
  ctxMask.lineCap = "round";
  ctxMask.lineJoin = "round";
  
  if (state.brushMode === "draw") {
    ctxMask.strokeStyle = "white"; // White mask holds subject target pixels
  } else {
    ctxMask.strokeStyle = "black"; // Black mask denotes pristine backgrounds
  }
  
  ctxMask.lineWidth = state.brushSize * scaleX;
  ctxMask.beginPath();
  ctxMask.moveTo(x1 * scaleX, y1 * scaleY);
  ctxMask.lineTo(x2 * scaleX, y2 * scaleY);
  ctxMask.stroke();
}

function stopDrawing() {
  if (!state.isDrawing) return;
  state.isDrawing = false;
  
  // Push stroke to history stack
  if (state.currentStroke && state.currentStroke.points.length > 0) {
    state.strokeHistory.push(state.currentStroke);
    state.currentStroke = null;
    
    // Enable undo & erase controls
    elBtnUndo.disabled = false;
    elBtnClearMask.disabled = false;
    elBtnErase.disabled = false;
  }
}

// Render glowing circular cursor ring matching current brush scale
function drawBrushCursor(cx, cy) {
  if (!state.originalImage) return;

  const ctxDraw = elDrawingCanvas.getContext("2d");
  
  // We need to re-render overlay strokes as clearing drawing canvas cleans everything.
  // So instead of clearing the screen, we:
  // 1. Draw all saved strokes from scratch on a temp buffer.
  // 2. Render them to screen.
  // 3. Superimpose the cursor circle.
  // Wait, to keep performance fluid at 60fps, we can just clear the screen context
  // and quickly re-draw all completed strokes plus the cursor ring.
  
  redrawAllStrokesFromHistory();

  if (cx !== undefined && cy !== undefined) {
    ctxDraw.globalCompositeOperation = "source-over";
    ctxDraw.beginPath();
    ctxDraw.arc(cx, cy, state.brushSize / 2, 0, Math.PI * 2);
    ctxDraw.strokeStyle = "rgba(168, 85, 247, 0.9)"; // Violet ring
    ctxDraw.lineWidth = 2;
    ctxDraw.stroke();
    
    // Inner cyan target dot
    ctxDraw.beginPath();
    ctxDraw.arc(cx, cy, 2, 0, Math.PI * 2);
    ctxDraw.fillStyle = "rgba(34, 211, 248, 0.9)";
    ctxDraw.fill();
  }
}

// Redraws all strokes in history stack to recreate screen drawing overlays
function redrawAllStrokesFromHistory() {
  const ctxDraw = elDrawingCanvas.getContext("2d");
  ctxDraw.clearRect(0, 0, state.dispWidth, state.dispHeight);
  
  state.strokeHistory.forEach(stroke => {
    ctxDraw.lineCap = "round";
    ctxDraw.lineJoin = "round";
    
    if (stroke.mode === "draw") {
      ctxDraw.strokeStyle = "rgba(244, 63, 94, 0.4)";
      ctxDraw.globalCompositeOperation = "source-over";
    } else {
      ctxDraw.globalCompositeOperation = "destination-out";
    }
    
    ctxDraw.lineWidth = stroke.size;
    
    if (stroke.points.length > 0) {
      ctxDraw.beginPath();
      ctxDraw.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctxDraw.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctxDraw.stroke();
    }
  });
}

// Rebuilds original high resolution hidden mask canvas based on current stroke stack
function rebuildHiddenMaskFromHistory() {
  const ctxMask = elHiddenMaskCanvas.getContext("2d");
  ctxMask.fillStyle = "black";
  ctxMask.fillRect(0, 0, state.origWidth, state.origHeight);

  const scaleX = state.origWidth / state.dispWidth;
  const scaleY = state.origHeight / state.dispHeight;

  state.strokeHistory.forEach(stroke => {
    ctxMask.lineCap = "round";
    ctxMask.lineJoin = "round";
    
    if (stroke.mode === "draw") {
      ctxMask.strokeStyle = "white";
    } else {
      ctxMask.strokeStyle = "black";
    }
    
    ctxMask.lineWidth = stroke.size * scaleX;
    
    if (stroke.points.length > 0) {
      ctxMask.beginPath();
      ctxMask.moveTo(stroke.points[0].x * scaleX, stroke.points[0].y * scaleY);
      for (let i = 1; i < stroke.points.length; i++) {
        ctxMask.lineTo(stroke.points[i].x * scaleX, stroke.points[i].y * scaleY);
      }
      ctxMask.stroke();
    }
  });
}

function handleUndoStroke() {
  if (state.strokeHistory.length === 0) return;
  
  state.strokeHistory.pop();
  
  redrawAllStrokesFromHistory();
  rebuildHiddenMaskFromHistory();

  if (state.strokeHistory.length === 0) {
    elBtnUndo.disabled = true;
    elBtnClearMask.disabled = true;
    elBtnErase.disabled = true;
  }
}

function clearActiveMasks() {
  state.strokeHistory = [];
  redrawAllStrokesFromHistory();
  rebuildHiddenMaskFromHistory();
  
  elBtnUndo.disabled = true;
  elBtnClearMask.disabled = true;
  elBtnErase.disabled = true;
}

// --- OpenCV.js WASM Inpainting Engine ---
function executeInpaintingPipeline() {
  if (!state.originalImage || state.strokeHistory.length === 0) return;

  // Show processing loader
  elProcessingOverlay.style.display = "flex";
  
  // Defer execution slightly to let UI render the processing layout
  setTimeout(() => {
    try {
      const tStart = performance.now();

      // 1. Read source data and mask from hidden canvases into OpenCV mats
      let src = cv.imread(elHiddenSourceCanvas);
      let mask = cv.imread(elHiddenMaskCanvas);
      
      // OpenCV requires mask to be single-channel (GRAY scale)
      cv.cvtColor(mask, mask, cv.COLOR_RGBA2GRAY);
      
      // OpenCV inpaint requires source to be 8-bit 1-channel or 3-channel (not 4-channel RGBA)
      let srcRGB = new cv.Mat();
      cv.cvtColor(src, srcRGB, cv.COLOR_RGBA2RGB);
      
      // Destination matrix holds result
      let dstRGB = new cv.Mat();
      
      // 2. Select corresponding method
      const method = state.algorithm === "ns" ? cv.INPAINT_NS : cv.INPAINT_TELEA;
      
      // 3. Execute inpainting computation natively in WebAssembly
      cv.inpaint(srcRGB, mask, dstRGB, state.radius, method);
      
      // Convert result back to RGBA
      let dst = new cv.Mat();
      cv.cvtColor(dstRGB, dst, cv.COLOR_RGB2RGBA);
      
      // 4. Render output back onto canvases
      cv.imshow(elHiddenSourceCanvas, dst);
      
      // Draw new cleaned version onto viewport canvas
      const ctxImg = elImageCanvas.getContext("2d");
      ctxImg.clearRect(0, 0, state.dispWidth, state.dispHeight);
      ctxImg.drawImage(elHiddenSourceCanvas, 0, 0, state.dispWidth, state.dispHeight);
      
      const tEnd = performance.now();
      console.log(`AI Inpainting completed in ${(tEnd - tStart).toFixed(2)} ms.`);

      // 5. Clean up memory allocations immediately (CRITICAL in OpenCV.js!)
      src.delete();
      mask.delete();
      srcRGB.delete();
      dstRGB.delete();
      dst.delete();
      
      // 6. Reset drawing masks
      clearActiveMasks();
      
      // UI feedback
      document.getElementById("image-status-badge").textContent = "Image Erased & Cleaned";
      document.getElementById("image-status-badge").className = "badge green";

    } catch (err) {
      console.error("OpenCV inpaint failed.", err);
      alert("Error: Engine execution failed. Some dimensions may be incompatible, please try another image.");
    } finally {
      // Hide processing screen
      elProcessingOverlay.style.display = "none";
    }
  }, 100);
}

// --- Image file exporter ---
function triggerDownloadCleanImage() {
  if (!state.originalImage) return;

  // Export directly from full-resolution hidden canvas
  const downloadUrl = elHiddenSourceCanvas.toDataURL("image/png");
  
  // Format clean file naming convention
  const baseName = state.imageName.substring(0, state.imageName.lastIndexOf(".")) || "photo";
  const downloadName = `${baseName}_erased.png`;

  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = downloadName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
