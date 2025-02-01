const southWest = L.latLng(40.4550081, -74.4957839);
const northEast = L.latLng(40.538852, -74.4074799);
const bounds = L.latLngBounds(southWest, northEast);

const map = L.map('map', {
    maxBounds: bounds,
    maxBoundsViscosity: 1.3,
    zoomControl: false,
    inertiaDeceleration: 1000,
    preferCanvas: true,
}).setView([40.507476, -74.4541267], 14);

map.setMinZoom(13);

L.tileLayer('https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token=' + mapbox_token, {
    maxZoom: 20,
    id: 'mapbox/streets-v11',
}).addTo(map);

let linePoints = [];
let geometryLayer;
let selectedPoint = null;
let selectedIndex = -1;
let markers = [];
let pointHistory = [{ points: [], straightSegments: new Set() }];
let redoHistory = [];
let currentIndex = 0;
let straightSegments = new Set(); // Track which segments should be straight

// Get the shape type select element
const shapeTypeSelect = document.querySelector('.shape-type');
const mapTypeSelect = document.querySelector('.map-type');
const polylineModeSelect = document.querySelector('.polyline-mode');
const lineTypeSelect = document.querySelector('.line-type');
let currentShapeType = shapeTypeSelect.value;
let currentPolylineMode = polylineModeSelect.value;
let currentLineType = lineTypeSelect.value;

// Initialize polyline mode visibility since polyline is default
polylineModeSelect.style.display = 'inline';
lineTypeSelect.style.display = 'inline';

// Show/hide polyline mode selector based on shape type
shapeTypeSelect.addEventListener('change', (e) => {
    currentShapeType = e.target.value;
    // Show/hide polyline mode selector and line type selector
    const showControls = currentShapeType === 'polyline';
    polylineModeSelect.style.display = showControls ? 'inline' : 'none';
    lineTypeSelect.style.display = showControls ? 'inline' : 'none';
    // Clear existing geometry when switching types
    linePoints = [];
    straightSegments = new Set();
    pointHistory = [{ points: [], straightSegments: new Set() }];
    redoHistory = [];
    currentIndex = 0;
    updateGeometryLayer();
    updatePointCount();
});

polylineModeSelect.addEventListener('change', (e) => {
    currentPolylineMode = e.target.value;
    updateGeometryLayer();
});

lineTypeSelect.addEventListener('change', (e) => {
    currentLineType = e.target.value;
    updateGeometryLayer();
});

document.querySelector('.map-type').value = 'street';

mapTypeSelect.addEventListener('change', (e) => {
    const currentMapType = e.target.value;

    map.eachLayer(function (layer) {
        if (layer instanceof L.TileLayer) {
            map.removeLayer(layer);
        }
    });

    if (currentMapType === 'street') {
        currentMapType = 'streets-v11';
    } else if (currentMapType === 'satellite') {
        currentMapType = 'satellite-v9';
    }

    L.tileLayer('https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token=' + mapbox_token, {
        maxZoom: 20,
        id: 'mapbox/' + currentMapType,
    }).addTo(map);

});

function addPointToLine(latlng, index = null, isShiftPressed = false) {
    console.log('Adding point:', { index, isShiftPressed, existingPoints: linePoints.length });
    
    // Clear any straight segments that would be after our insert point
    if (index !== null) {
        // When inserting at index, we need to shift all segment indices after this point
        straightSegments = new Set(
            Array.from(straightSegments)
                .filter(segmentIndex => segmentIndex < index - 1)
                .map(segmentIndex => segmentIndex)
        );
        
        linePoints.splice(index, 0, latlng);
        if (isShiftPressed && index > 0) {
            straightSegments.add(index - 1);
            console.log('Added straight segment at index:', index - 1);
        }
    } else {
        if (isShiftPressed && linePoints.length > 0) {
            straightSegments.add(linePoints.length - 1);
            console.log('Added straight segment at index:', linePoints.length - 1);
        }
        linePoints.push(latlng);
    }
    
    console.log('Current straight segments:', Array.from(straightSegments));
    
    // Store the current state in history
    pointHistory[currentIndex + 1] = {
        points: linePoints.slice(),
        straightSegments: new Set(straightSegments)
    };
    currentIndex++;
    redoHistory = [];
    updateGeometryLayer();
    updatePointCount();
}

function interpolatePoints(points, tension = 0.5, numSegments = 10) {
    const result = [];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] || points[i];
        const p1 = points[i];
        const p2 = points[i + 1] || points[i];
        const p3 = points[i + 2] || points[i + 1];

        for (let j = 0; j < numSegments; j++) {
            const t = j / numSegments;
            const t2 = t * t;
            const t3 = t2 * t;

            const x = 0.5 * (
                (2 * p1.lat) +
                (-p0.lat + p2.lat) * t +
                (2 * p0.lat - 5 * p1.lat + 4 * p2.lat - p3.lat) * t2 +
                (-p0.lat + 3 * p1.lat - 3 * p2.lat + p3.lat) * t3
            );

            const y = 0.5 * (
                (2 * p1.lng) +
                (-p0.lng + p2.lng) * t +
                (2 * p0.lng - 5 * p1.lng + 4 * p2.lng - p3.lng) * t2 +
                (-p0.lng + 3 * p1.lng - 3 * p2.lng + p3.lng) * t3
            );

            result.push(L.latLng(x, y));
        }
    }
    result.push(points[points.length - 1]); // Add the last point explicitly
    return result;
}

function updateGeometryLayer() {
    // Remove the previous geometry and markers
    if (geometryLayer) {
        map.removeLayer(geometryLayer);
    }
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];

    if (linePoints.length > 1) { // Start drawing with 2 points
        if (currentShapeType === 'polyline') {
            if (currentLineType === 'curved') {
                console.log('Updating geometry - Points:', linePoints.length, 'Straight segments:', Array.from(straightSegments));
                // Handle mixed curved and straight segments
                let allPoints = [];
                let curveStart = 0;
                
                for (let i = 1; i < linePoints.length; i++) {
                    if (straightSegments.has(i-1)) {
                        console.log('Processing straight segment at:', i-1);
                        // If there are points to curve before this straight segment
                        if (curveStart < i - 1) {
                            const curvePoints = linePoints.slice(curveStart, i);
                            console.log('Curving points before straight segment:', curveStart, 'to', i);
                            allPoints.push(...interpolatePoints(curvePoints));
                        }
                        // Add the straight segment
                        allPoints.push(linePoints[i-1], linePoints[i]);
                        curveStart = i;
                    } else if (i === linePoints.length - 1) {
                        // Last point - curve all remaining points
                        const curvePoints = linePoints.slice(curveStart);
                        console.log('Curving final points from:', curveStart);
                        allPoints.push(...interpolatePoints(curvePoints));
                    }
                }
                
                // If we only have two points or haven't added any points yet
                if (allPoints.length === 0) {
                    console.log('No segments processed, interpolating all points');
                    allPoints = interpolatePoints(linePoints);
                }
                
                geometryLayer = L.polyline(allPoints, {
                    color: 'blue',
                    weight: 3
                }).addTo(map);
            } else {
                // Create straight polyline
                geometryLayer = L.polyline(linePoints, {
                    color: 'blue',
                    weight: 3
                }).addTo(map);
            }
        } else if (currentShapeType === 'polygon' && linePoints.length >= 3) {
            geometryLayer = L.polygon(linePoints, {
                color: 'blue',
                weight: 3
            }).addTo(map);
        }

        // Add markers for each point
        linePoints.forEach((point, index) => {
            const marker = L.circleMarker(point, {
                radius: 3, // Smaller radius
                fillColor: index === selectedIndex ? 'red' : 'white',
                color: '#000',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.7
            }); // Do not add to map yet

            const draggableMarker = L.marker(point, {
                icon: L.divIcon({
                    className: 'custom-div-icon',
                    html: `<div style='background-color: ${index === selectedIndex ? 'red' : 'white'}; width: 6px; height: 6px; border-radius: 50%; border: 2px solid black;'></div>`,
                    iconSize: [6, 6], // Smaller icon size
                    iconAnchor: [3, 3] // Adjust anchor to match size
                }),
                draggable: true
            }).addTo(map);

            draggableMarker.on('click', () => {
                if (selectedIndex === index) {
                    deselectPoint();
                } else {
                    selectPoint(index);
                }
            });

            draggableMarker.on('dragend', (event) => {
                const newLatLng = event.target.getLatLng();
                linePoints[index] = L.latLng(newLatLng.lat, newLatLng.lng); // Ensure correct format
                updateGeometryLayer(); // Redraw the geometry with updated points
            });

            markers.push(draggableMarker);
        });
    }
}

function selectPoint(index) {
    if (selectedIndex !== -1) {
        deselectPoint();
    }
    selectedIndex = index;
    selectedPoint = linePoints[index];
    updateGeometryLayer();
}

function deselectPoint() {
    selectedIndex = -1;
    selectedPoint = null;
    updateGeometryLayer();
}

map.on('click', (e) => {
    const isShiftPressed = e.originalEvent.shiftKey && currentLineType === 'curved';
    console.log('Map clicked:', { 
        shift: e.originalEvent.shiftKey,
        selectedIndex,
        currentLineType,
        isShiftPressed 
    });
    
    if (selectedIndex !== -1) {
        addPointToLine(e.latlng, selectedIndex + 1, isShiftPressed);
        selectPoint(selectedIndex + 1);
    } else {
        addPointToLine(e.latlng, null, isShiftPressed);
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        deselectPoint();
    }
    if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undoLastPoint();
    }
    if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        redoLastPoint();
    }
});

function undoLastPoint() {
    if (currentIndex > 0) {
        currentIndex--;
        // Store current state in redo history
        redoHistory.push({
            points: linePoints.slice(),
            straightSegments: new Set(straightSegments)
        });
        
        // Restore previous state
        const historyItem = pointHistory[currentIndex];
        if (historyItem) {
            linePoints = historyItem.points ? historyItem.points.slice() : [];
            straightSegments = historyItem.straightSegments ? new Set(historyItem.straightSegments) : new Set();
            console.log('Undo - Restored straight segments:', Array.from(straightSegments));
        } else {
            linePoints = [];
            straightSegments = new Set();
        }
        
        updateGeometryLayer();
        updatePointCount();
    }
}

function redoLastPoint() {
    if (redoHistory.length > 0) {
        const historyItem = redoHistory.pop();
        currentIndex++;
        
        if (historyItem) {
            linePoints = historyItem.points ? historyItem.points.slice() : [];
            straightSegments = historyItem.straightSegments ? new Set(historyItem.straightSegments) : new Set();
            console.log('Redo - Restored straight segments:', Array.from(straightSegments));
        } else {
            linePoints = [];
            straightSegments = new Set();
        }
        
        updateGeometryLayer();
        updatePointCount();
    }
}

const exportButton = document.getElementById('exportButton');
exportButton.onclick = exportGeometryToJSON;

const pointCountDiv = document.getElementById('pointCount');

// Calculate distance between two points
function calculateDistance(point1, point2) {
    const lat1 = point1.lat;
    const lon1 = point1.lng;
    const lat2 = point2.lat;
    const lon2 = point2.lng;
    
    // Haversine formula
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

// Calculate total distance of the polyline
function calculateTotalDistance() {
    let totalDistance = 0;
    for (let i = 0; i < linePoints.length - 1; i++) {
        totalDistance += calculateDistance(linePoints[i], linePoints[i + 1]);
    }
    return totalDistance;
}

// Calculate percentage for each point
function calculatePercentages() {
    if (linePoints.length < 2) return [];
    
    const totalDistance = calculateTotalDistance();
    let currentDistance = 0;
    const percentages = [0]; // First point is always 0%
    
    for (let i = 1; i < linePoints.length; i++) {
        currentDistance += calculateDistance(linePoints[i-1], linePoints[i]);
        percentages.push(currentDistance / totalDistance);
    }
    
    return percentages;
}

function exportGeometryToJSON() {
    let exportData;
    
    // Convert coordinates to [longitude, latitude] format
    const coordinates = linePoints.map((point) => [
        parseFloat(point.lng.toFixed(5)),
        parseFloat(point.lat.toFixed(5))
    ]);

    if (currentShapeType === 'polygon' && coordinates.length >= 3) {
        // For polygons, ensure the ring is closed
        if (coordinates[0] !== coordinates[coordinates.length - 1]) {
            coordinates.push(coordinates[0]);
        }
        // Polygon requires an array of linear rings (arrays of positions)
        exportData = {
            type: "Feature",
            geometry: {
                type: "Polygon",
                coordinates: [coordinates] // Array of linear rings (we just have one)
            },
            properties: {}
        };
    } else {
        // Export as LineString
        if (currentShapeType === 'polyline' && currentPolylineMode === 'percentage') {
            const percentages = calculatePercentages();
            exportData = {
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: coordinates
                },
                properties: {
                    percentages: percentages.map(p => parseFloat(p.toFixed(4)))
                }
            };
        } else {
            exportData = {
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: coordinates
                },
                properties: {}
            };
        }
    }

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute('href', dataStr);
    downloadAnchorNode.setAttribute('download', `${currentShapeType}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function updatePointCount() {
    pointCountDiv.textContent = `Points: ${linePoints.length}`;
}