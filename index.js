// Import the pipeline function from Transformers.js
// Try to use the ES module version, with fallback to the UMD version
let pipeline;
try {
  const module = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.8.0/dist/transformers.min.js');
  pipeline = module.pipeline;
} catch (e) {
  console.warn('ES module import failed, trying UMD version:', e);
  // Load UMD version as fallback
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.8.0/dist/transformers.min.js';
  script.async = true;
  document.head.appendChild(script);
  
  // Wait for script to load
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = reject;
  });
  
  // Now the global Transformers object should be available
  pipeline = window.Transformers.pipeline;
}

// DOM Elements - using a more organized approach with a single config object
const elements = {
  status: document.getElementById('status'),
  image: document.getElementById('image'),
  imageContainer: document.getElementById('image-container'),
  fileUpload: document.getElementById('file-upload'),
  fileName: document.getElementById('file-name'),
  processButton: document.getElementById('process-button'),
  resetButton: document.getElementById('reset-button'),
  uploadSection: document.getElementById('upload-section'),
  thresholdSlider: document.getElementById('detection-threshold'),
  thresholdValue: document.getElementById('threshold-value'),
  maxObjectsSlider: document.getElementById('max-objects'),
  maxObjectsValue: document.getElementById('max-objects-value')
};

// Global state
const state = {
  detector: null,
  selectedImage: null,
  isProcessing: false
};

// Error types for better handling
const ErrorTypes = {
  NETWORK: 'network',
  MODEL: 'model',
  FILE: 'file',
  PROCESSING: 'processing'
};

// Initialize the detector model with retries
async function initializeDetector(retries = 3) {
  updateStatus('Loading object detection model...');
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Add cache busting and use more specific model path
      const options = {
        quantized: false,
        progress_callback: (progress) => {
          if (progress.status === 'progress') {
            const percentage = Math.round(progress.value * 100);
            updateStatus(`Loading model: ${percentage}%`);
          }
        }
      };
      
      state.detector = await pipeline('object-detection', 'Xenova/yolos-tiny', options);
      updateStatus('Ready to upload an image');
      return true;
    } catch (err) {
      console.error(`Model loading attempt ${attempt + 1} failed:`, err);
      
      // If we have more retries, wait before trying again
      if (attempt < retries - 1) {
        updateStatus(`Loading model failed, retrying (${attempt + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        handleError(err, ErrorTypes.MODEL);
        return false;
      }
    }
  }
}

// Helper function to update status message
function updateStatus(message) {
  elements.status.textContent = message;
}

// Error handling function
function handleError(error, type) {
  console.error(`${type} error:`, error);
  
  switch (type) {
    case ErrorTypes.NETWORK:
      updateStatus('Network error. Please check your connection and try again.');
      break;
    case ErrorTypes.MODEL:
      updateStatus('Error loading model. Please refresh the page or try again later.');
      break;
    case ErrorTypes.FILE:
      updateStatus('Error processing your file. Please try another image.');
      break;
    case ErrorTypes.PROCESSING:
      updateStatus('Error while detecting objects. Please try again.');
      break;
    default:
      updateStatus('An unexpected error occurred: ' + error.message);
  }
}

// Handle file selection
elements.fileUpload.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) {
    resetUploadState();
    return;
  }
  
  // Validate file is an image
  if (!file.type.startsWith('image/')) {
    updateStatus('Please select a valid image file.');
    return;
  }
  
  try {
    // Clear previous detection boxes
    clearDetections();
    
    // Update file name display
    elements.fileName.textContent = file.name;
    
    // Enable the process button
    elements.processButton.disabled = false;
    
    // Preview the image
    if (state.selectedImage) {
      URL.revokeObjectURL(state.selectedImage);
    }
    
    state.selectedImage = URL.createObjectURL(file);
    elements.image.src = state.selectedImage;
    elements.image.style.display = 'block';
    
    updateStatus('Image uploaded. Click "Detect Objects" to process.');
  } catch (err) {
    handleError(err, ErrorTypes.FILE);
    resetUploadState();
  }
});

// Update threshold display when slider changes
elements.thresholdSlider.addEventListener('input', () => {
  elements.thresholdValue.textContent = elements.thresholdSlider.value;
});

// Update max objects display when slider changes
elements.maxObjectsSlider.addEventListener('input', () => {
  elements.maxObjectsValue.textContent = elements.maxObjectsSlider.value;
});

// Function to limit and sort detected objects
function limitObjects(detectedObjects, maxObjects) {
  // Sort objects by confidence score (highest first)
  const sortedObjects = [...detectedObjects].sort((a, b) => b.score - a.score);
  
  // Limit to maximum number of objects
  return sortedObjects.slice(0, maxObjects);
}

// Generate a color based on the label for consistent colors
function getColorForLabel(label) {
  // Simple hash function to generate a number from a string
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = ((hash << 5) - hash) + label.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Generate a hue based on the hash and use it to create an HSL color
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 45%)`;
}

// Process image button
elements.processButton.addEventListener('click', async () => {
  console.log("button pushed")
  if (!state.selectedImage || !state.detector || state.isProcessing) return;
  
  // Prevent double processing
  state.isProcessing = true;
  elements.processButton.disabled = true;
  
  try {
    // Update status
    updateStatus('Detecting objects...');
    
    // Get the current threshold and max objects values from the sliders
    const threshold = parseFloat(elements.thresholdSlider.value);
    const maxObjects = parseInt(elements.maxObjectsSlider.value);
    
    // Perform detection
    let detectedObjects = await state.detector(elements.image.src, {
      threshold: threshold,
      percentage: true
    });
    
    // Limit and sort the objects by confidence score
    detectedObjects = limitObjects(detectedObjects, maxObjects);
    
    // If no objects detected
    if (detectedObjects.length === 0) {
      updateStatus('No objects detected. Try another image or adjust sensitivity.');
    } else {
      const objectsFound = detectedObjects.length;
      const objectsLimit = parseInt(elements.maxObjectsSlider.value);
      
      if (objectsFound >= objectsLimit) {
        updateStatus(`Showing top ${objectsFound} objects (maximum set to ${objectsLimit}).`);
      } else {
        updateStatus(`Detected ${objectsFound} objects.`);
      }
      
      // Draw detection boxes
      detectedObjects.forEach(item => {
        drawObjectBox(item);
      });
    }
    
    // Show reset button
    elements.resetButton.style.display = 'block';
    
  } catch (err) {
    handleError(err, ErrorTypes.PROCESSING);
  } finally {
    state.isProcessing = false;
  }
});

// Reset button
elements.resetButton.addEventListener('click', () => {
  resetUploadState();
  elements.resetButton.style.display = 'none';
  updateStatus('Ready to upload a new image');
});

// Draw detection box for an object
function drawObjectBox(detectedObject) {
  const { label, score, box } = detectedObject;
  const { xmax, xmin, ymax, ymin } = box;

  // Generate a color based on the label for consistency
  const color = getColorForLabel(label);
  
  // Draw the box
  const boxElement = document.createElement('div');
  boxElement.className = 'bounding-box';
  Object.assign(boxElement.style, {
    borderColor: color,
    left: `${100 * xmin}%`,
    top: `${100 * ymin}%`,
    width: `${100 * (xmax - xmin)}%`,
    height: `${100 * (ymax - ymin)}%`,
  });

  // Draw label
  const labelElement = document.createElement('span');
  labelElement.textContent = `${label}: ${Math.floor(score * 100)}%`;
  labelElement.className = 'bounding-box-label';
  labelElement.style.backgroundColor = color;

  boxElement.appendChild(labelElement);
  elements.imageContainer.appendChild(boxElement);
}

// Clear detection boxes
function clearDetections() {
  const boxes = elements.imageContainer.querySelectorAll('.bounding-box');
  boxes.forEach(box => box.remove());
}

// Reset the upload state
function resetUploadState() {
  elements.fileName.textContent = 'No file selected';
  elements.processButton.disabled = true;
  elements.image.style.display = 'none';
  elements.image.src = '';
  
  if (state.selectedImage) {
    URL.revokeObjectURL(state.selectedImage);
    state.selectedImage = null;
  }
  
  clearDetections();
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
  await initializeDetector();
  
  // Add offline support notification
  window.addEventListener('online', () => {
    updateStatus('Connection restored. Ready to upload an image.');
  });
  
  window.addEventListener('offline', () => {
    updateStatus('You are offline. Some features may not work properly.');
  });
});