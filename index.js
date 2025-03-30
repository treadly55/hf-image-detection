// Debug flag - set to true to enable detailed console logging
const DEBUG = true;

// Logging helper function
function debug(...args) {
  if (DEBUG) {
    console.log('[DEBUG]', ...args);
  }
}

debug('Script starting...');

// Try to load the transformers library with fallback options
let pipeline;
let loadingFallbackUsed = false;

debug('Setting up transformers.js loading...');

// Function to load the UMD version as fallback
async function loadUMDFallback() {
  debug('Loading UMD fallback version...');
  loadingFallbackUsed = true;
  
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.8.0/dist/transformers.min.js';
    script.async = true;
    
    script.onload = () => {
      debug('UMD script loaded successfully');
      if (window.Transformers && window.Transformers.pipeline) {
        debug('Transformers global object found');
        resolve(window.Transformers.pipeline);
      } else {
        debug('Transformers global object NOT found after script load');
        reject(new Error('Failed to load Transformers.js UMD version'));
      }
    };
    
    script.onerror = () => {
      debug('Error loading UMD script');
      reject(new Error('Failed to load Transformers.js UMD script'));
    };
    
    document.head.appendChild(script);
  });
}

// First try the ES module version
async function loadTransformers() {
  try {
    debug('Attempting to load ES module version...');
    const module = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.8.0/dist/transformers.min.js');
    debug('ES module loaded successfully');
    return module.pipeline;
  } catch (e) {
    debug('ES module import failed:', e);
    return await loadUMDFallback();
  }
}

// DOM Elements
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
  isProcessing: false,
  modelLoaded: false
};

// Error types
const ErrorTypes = {
  NETWORK: 'network',
  MODEL: 'model',
  FILE: 'file',
  PROCESSING: 'processing'
};

// Update status message
function updateStatus(message) {
  debug('Status update:', message);
  elements.status.textContent = message;
}

// Error handling function
function handleError(error, type) {
  console.error(`[ERROR] ${type}:`, error);
  
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

// Initialize the detector model with detailed logging
async function initializeDetector(retries = 3) {
  updateStatus('Loading object detection model...');
  debug('Initializing detector, retries =', retries);
  
  // Test model endpoint accessibility
  try {
    debug('Testing access to model endpoint...');
    const testUrl = 'https://huggingface.co/Xenova/yolos-tiny/resolve/main/config.json';
    const testResponse = await fetch(testUrl, { 
      method: 'HEAD',
      mode: 'cors'
    });
    debug('Model endpoint test response:', testResponse.status, testResponse.ok);
    
    if (!testResponse.ok) {
      debug('CORS issue detected: Cannot access model endpoint directly');
      // Continue anyway as the library might handle this differently
    }
  } catch (testErr) {
    debug('Error testing model endpoint access:', testErr);
    // Continue with model loading anyway
  }
  
  // First make sure pipeline is available
  try {
    if (!pipeline) {
      debug('Loading pipeline function...');
      pipeline = await loadTransformers();
      debug('Pipeline loaded:', !!pipeline);
    }
  } catch (err) {
    debug('Failed to load pipeline:', err);
    handleError(err, ErrorTypes.MODEL);
    return false;
  }
  
  // Then load the model
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      debug(`Model loading attempt ${attempt + 1}/${retries}`);
      
      // Add a progress callback for better user feedback
      // const options = {
      //   quantized: false,
      //   progress_callback: (progress) => {
      //     debug('Model loading progress:', progress);
      //     if (progress.status === 'progress') {
      //       const percentage = Math.round(progress.value * 100);
      //       updateStatus(`Loading model: ${percentage}%`);
      //     }
      //   }
      // };

      const options = {
        quantized: false,
        progress_callback: (progress) => {
          debug('Model loading progress:', progress);
          if (progress.status === 'progress') {
            const percentage = Math.round(progress.value * 100);
            updateStatus(`Loading model: ${percentage}%`);
          }
        },
        cache_dir: './models', // Try using a local cache directory
        local_files_only: false, // Allow downloading if not in cache
        use_auth_token: false, // Don't use authentication
        revision: 'main' // Specify the revision explicitly
      };

      
      debug('Calling pipeline with model name Xenova/yolos-tiny');
      if (loadingFallbackUsed && window.Transformers) {
        debug('Using global Transformers object for detection');
        state.detector = await window.Transformers.pipeline('object-detection', 'Xenova/yolos-tiny', options);
      } else {
        debug('Using imported pipeline for detection');
        state.detector = await pipeline('object-detection', 'Xenova/yolos-tiny', options);
      }
      
      debug('Model loaded successfully, detector =', !!state.detector);
      state.modelLoaded = true;
      updateStatus('Ready to upload an image');
      return true;
    } catch (err) {
      console.error(`Model loading attempt ${attempt + 1} failed:`, err);
      
      // If we have more retries, wait before trying again
      if (attempt < retries - 1) {
        updateStatus(`Loading model failed, retrying (${attempt + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        debug('All model loading attempts failed');
        handleError(err, ErrorTypes.MODEL);
        return false;
      }
    }
  }
  return false;
}

// Handle file selection
elements.fileUpload.addEventListener('change', (event) => {
  debug('File upload change event triggered');
  const file = event.target.files[0];
  if (!file) {
    debug('No file selected');
    resetUploadState();
    return;
  }
  
  // Validate file is an image
  if (!file.type.startsWith('image/')) {
    debug('Invalid file type:', file.type);
    updateStatus('Please select a valid image file.');
    return;
  }
  
  try {
    debug('Processing uploaded file:', file.name);
    // Clear previous detection boxes
    clearDetections();
    
    // Update file name display
    elements.fileName.textContent = file.name;
    
    // Enable the process button
    elements.processButton.disabled = false;
    
    // Revoke previous object URL if exists
    if (state.selectedImage) {
      debug('Revoking previous object URL');
      URL.revokeObjectURL(state.selectedImage);
    }
    
    // Preview the image
    state.selectedImage = URL.createObjectURL(file);
    debug('Created object URL for image:', state.selectedImage);
    elements.image.src = state.selectedImage;
    elements.image.style.display = 'block';
    
    updateStatus('Image uploaded. Click "Detect Objects" to process.');
  } catch (err) {
    debug('Error processing uploaded file:', err);
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
  debug('Limiting detected objects to', maxObjects);
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

// Process image button with detailed debugging
elements.processButton.addEventListener('click', async () => {
  console.log("===============================");
  console.log("DETECT BUTTON CLICKED");
  console.log("===============================");
  console.log("Detector state: ", {
    selectedImage: !!state.selectedImage,
    detector: !!state.detector,
    isProcessing: state.isProcessing,
    modelLoaded: state.modelLoaded
  });
  
  // Check for required conditions with individual debugging
  if (!state.selectedImage) {
    console.log("ERROR: No image selected - returning early");
    return;
  }
  
  if (!state.detector) {
    console.log("ERROR: Detector not loaded - returning early");
    
    // Try to re-initialize the detector
    console.log("Attempting to re-initialize the detector...");
    const success = await initializeDetector(1);
    if (!success || !state.detector) {
      console.log("Re-initialization failed");
      updateStatus('Model not loaded. Please refresh the page and try again.');
      return;
    }
    console.log("Re-initialization successful");
  }
  
  if (state.isProcessing) {
    console.log("ERROR: Already processing an image - returning early");
    return;
  }
  
  // If we got here, all conditions passed
  console.log("All preconditions passed, beginning processing");
  
  // Prevent double processing
  state.isProcessing = true;
  elements.processButton.disabled = true;
  
  try {
    // Update status
    updateStatus('Detecting objects...');
    
    // Get the current threshold and max objects values from the sliders
    const threshold = parseFloat(elements.thresholdSlider.value);
    const maxObjects = parseInt(elements.maxObjectsSlider.value);
    
    console.log("Detection parameters:", { threshold, maxObjects });
    console.log("Image source:", elements.image.src.substring(0, 50) + "...");
    
    // Perform detection with a timeout
    console.log("Starting object detection");
    let detectionPromise = Promise.race([
      state.detector(elements.image.src, {
        threshold: threshold,
        percentage: true
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Detection timed out after 30 seconds")), 30000)
      )
    ]);
    
    let detectedObjects = await detectionPromise;
    console.log("Detection completed successfully");
    console.log("Raw detection results:", detectedObjects);
    
    // Limit and sort the objects by confidence score
    detectedObjects = limitObjects(detectedObjects, maxObjects);
    console.log("After limiting:", detectedObjects);
    
    // If no objects detected
    if (detectedObjects.length === 0) {
      console.log("No objects detected");
      updateStatus('No objects detected. Try another image or adjust sensitivity.');
    } else {
      const objectsFound = detectedObjects.length;
      const objectsLimit = parseInt(elements.maxObjectsSlider.value);
      
      console.log(`Found ${objectsFound} objects`);
      
      if (objectsFound >= objectsLimit) {
        updateStatus(`Showing top ${objectsFound} objects (maximum set to ${objectsLimit}).`);
      } else {
        updateStatus(`Detected ${objectsFound} objects.`);
      }
      
      // Draw detection boxes
      console.log("Drawing bounding boxes");
      detectedObjects.forEach((item, index) => {
        console.log(`Drawing box ${index + 1} for ${item.label}`);
        drawObjectBox(item);
      });
    }
    
    // Show reset button
    console.log("Showing reset button");
    elements.resetButton.style.display = 'block';
    
  } catch (err) {
    console.error("ERROR DURING DETECTION:", err);
    handleError(err, ErrorTypes.PROCESSING);
  } finally {
    console.log("Processing complete, resetting isProcessing flag");
    state.isProcessing = false;
    elements.processButton.disabled = false;
  }
});

// Reset button
elements.resetButton.addEventListener('click', () => {
  debug('Reset button clicked');
  resetUploadState();
  elements.resetButton.style.display = 'none';
  updateStatus('Ready to upload a new image');
});

// Draw detection box for an object
function drawObjectBox(detectedObject) {
  const { label, score, box } = detectedObject;
  const { xmax, xmin, ymax, ymin } = box;

  debug(`Drawing box for ${label} (${Math.floor(score * 100)}%) at coordinates:`, 
    {xmin, ymin, xmax, ymax});

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
  debug('Clearing detection boxes');
  const boxes = elements.imageContainer.querySelectorAll('.bounding-box');
  boxes.forEach(box => box.remove());
}

// Reset the upload state
function resetUploadState() {
  debug('Resetting upload state');
  elements.fileName.textContent = 'No file selected';
  elements.processButton.disabled = true;
  elements.image.style.display = 'none';
  elements.image.src = '';
  
  if (state.selectedImage) {
    debug('Revoking object URL');
    URL.revokeObjectURL(state.selectedImage);
    state.selectedImage = null;
  }
  
  clearDetections();
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
  debug('DOM content loaded, initializing application');
  
  // Check if running on Netlify with proper headers
  try {
    const response = await fetch('/_headers', { method: 'HEAD' });
    debug('Headers file response:', response.status);
  } catch (e) {
    debug('No _headers file accessible, which may be normal');
  }
  
  // Start model initialization
  const success = await initializeDetector();
  debug('Initial model loading success:', success);
  
  // Add offline support notification
  window.addEventListener('online', () => {
    debug('Browser came online');
    updateStatus('Connection restored. Ready to upload an image.');
  });
  
  window.addEventListener('offline', () => {
    debug('Browser went offline');
    updateStatus('You are offline. Some features may not work properly.');
  });
  
  // Log initialization complete
  debug('Application initialization complete');
});

// Log that the script has finished loading
debug('Script loaded successfully');