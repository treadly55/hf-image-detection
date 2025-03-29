import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.8.0';

// DOM Elements
const statusEl = document.getElementById('status');
const imageEl = document.getElementById('image');
const imageContainer = document.getElementById('image-container');
const fileUpload = document.getElementById('file-upload');
const fileName = document.getElementById('file-name');
const processButton = document.getElementById('process-button');
const resetButton = document.getElementById('reset-button');
const uploadSection = document.getElementById('upload-section');
const thresholdSlider = document.getElementById('detection-threshold');
const thresholdValue = document.getElementById('threshold-value');

// Global variables
let detector = null;
let selectedImage = null;

// Initialize the detector model
async function initializeDetector() {
  statusEl.textContent = 'Loading object detection model...';
  try {
    detector = await pipeline('object-detection', 'Xenova/yolos-tiny');
    statusEl.textContent = 'Ready to upload an image';
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Error loading model: ' + err.message;
  }
}

// Handle file selection
fileUpload.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) {
    // Clear previous detection boxes
    clearDetections();
    
    // Update file name display
    fileName.textContent = file.name;
    
    // Enable the process button
    processButton.disabled = false;
    
    // Preview the image
    selectedImage = URL.createObjectURL(file);
    imageEl.src = selectedImage;
    imageEl.style.display = 'block';
    
    statusEl.textContent = 'Image uploaded. Click "Detect Objects" to process.';
  } else {
    resetUploadState();
  }
});

// Update threshold display when slider changes
thresholdSlider.addEventListener('input', () => {
  thresholdValue.textContent = thresholdSlider.value;
});

// Process image button
processButton.addEventListener('click', async () => {
  if (!selectedImage || !detector) return;
  
  try {
    // Update status
    statusEl.textContent = 'Detecting objects...';
    processButton.disabled = true;
    
    // Get the current threshold value from the slider
    const threshold = parseFloat(thresholdSlider.value);
    
    // Perform detection
    const detectedObjects = await detector(imageEl.src, {
      threshold: threshold,  // Use the user-selected threshold
      percentage: true
    });
    
    // If no objects detected
    if (detectedObjects.length === 0) {
      statusEl.textContent = 'No objects detected. Try another image.';
    } else {
      statusEl.textContent = `Detected ${detectedObjects.length} objects.`;
      
      // Draw detection boxes
      detectedObjects.forEach(item => {
        drawObjectBox(item);
      });
    }
    
    // Show reset button
    resetButton.style.display = 'block';
    
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Error processing image: ' + err.message;
  }
});

// Reset button
resetButton.addEventListener('click', () => {
  resetUploadState();
  resetButton.style.display = 'none';
  statusEl.textContent = 'Ready to upload a new image';
});

// Draw detection box for an object
function drawObjectBox(detectedObject) {
  const { label, score, box } = detectedObject;
  const { xmax, xmin, ymax, ymin } = box;

  // Generate a random color for the box
  const color = '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, 0);
  
  // Draw the box
  const boxElement = document.createElement('div');
  boxElement.className = 'bounding-box';
  Object.assign(boxElement.style, {
    borderColor: color,
    left: 100 * xmin + '%',
    top: 100 * ymin + '%',
    width: 100 * (xmax - xmin) + '%',
    height: 100 * (ymax - ymin) + '%',
  });

  // Draw label
  const labelElement = document.createElement('span');
  labelElement.textContent = `${label}: ${Math.floor(score * 100)}%`;
  labelElement.className = 'bounding-box-label';
  labelElement.style.backgroundColor = color;

  boxElement.appendChild(labelElement);
  imageContainer.appendChild(boxElement);
}

// Clear detection boxes
function clearDetections() {
  const boxes = imageContainer.querySelectorAll('.bounding-box');
  boxes.forEach(box => box.remove());
}

// Reset the upload state
function resetUploadState() {
  fileName.textContent = 'No file selected';
  processButton.disabled = true;
  imageEl.style.display = 'none';
  imageEl.src = '';
  if (selectedImage) {
    URL.revokeObjectURL(selectedImage);
    selectedImage = null;
  }
  clearDetections();
}

// Initialize on page load
(async () => {
  await initializeDetector();
})();