import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  SafeAreaView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';

const COLORS = {
  forest: '#14532D',
  blue: '#2F80ED',
  amber: '#F59E0B',
  red: '#DC2626',
  green: '#16A34A',
  ink: '#0B130E',
  card: '#142318',
  line: '#1E3A28',
  text: '#F0FDF4',
  muted: '#A3B8A8',
  darkInput: '#0F1A12',
};

export interface RideDestination {
  title: string;
  locationName: string;
  latitude: number;
  longitude: number;
}

export interface CreatedRoomData {
  groupCode: string;
  shareableUrl: string;
  destination: RideDestination;
  creatorName: string;
}

interface CreateRideDestinationScreenProps {
  creatorName: string;
  apiBaseUrl: string;
  authToken: string;
  isOnline: boolean;
  onCancel: () => void;
  onConfirmAndStartRide: (roomData: CreatedRoomData) => void;
}

interface PlacePrediction {
  place_id: string;
  description: string;
  structured_formatting?: {
    main_text: string;
    secondary_text: string;
  };
}

// Default region: Kathmandu Valley
const DEFAULT_REGION: Region = {
  latitude: 27.7172,
  longitude: 85.3240,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

/**
 * Reverse geocode coordinates to a human-readable address.
 * Returns null if geocoding fails — coordinates are still valid without an address.
 */
async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  try {
    const apiKey = typeof process !== 'undefined' && process.env
      ? process.env.GOOGLE_MAPS_API_KEY
      : undefined;

    if (!apiKey || apiKey === 'YOUR_GOOGLE_MAPS_API_KEY_HERE') {
      return null;
    }

    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${latitude},${longitude}` +
      `&key=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.results?.length > 0) {
      return data.results[0].formatted_address;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Search places using Google Places Autocomplete API.
 */
async function searchPlaces(query: string): Promise<PlacePrediction[]> {
  try {
    const apiKey = typeof process !== 'undefined' && process.env
      ? process.env.GOOGLE_MAPS_API_KEY
      : undefined;

    if (!apiKey || apiKey === 'YOUR_GOOGLE_MAPS_API_KEY_HERE') {
      console.warn('[DestinationScreen] Google Maps API key not configured for Places search');
      return [];
    }

    const url =
      `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
      `?input=${encodeURIComponent(query)}` +
      `&components=country:np` +
      `&key=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.predictions) {
      return data.predictions;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Get place details (coordinates) from a place_id.
 */
async function getPlaceDetails(
  placeId: string,
): Promise<{ latitude: number; longitude: number; name: string; address: string } | null> {
  try {
    const apiKey = typeof process !== 'undefined' && process.env
      ? process.env.GOOGLE_MAPS_API_KEY
      : undefined;

    if (!apiKey || apiKey === 'YOUR_GOOGLE_MAPS_API_KEY_HERE') {
      return null;
    }

    const url =
      `https://maps.googleapis.com/maps/api/place/details/json` +
      `?place_id=${placeId}` +
      `&fields=geometry,name,formatted_address` +
      `&key=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.result?.geometry?.location) {
      return {
        latitude: data.result.geometry.location.lat,
        longitude: data.result.geometry.location.lng,
        name: data.result.name || '',
        address: data.result.formatted_address || '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function CreateRideDestinationScreen({
  creatorName,
  apiBaseUrl,
  authToken,
  isOnline,
  onCancel,
  onConfirmAndStartRide,
}: CreateRideDestinationScreenProps) {
  const mapRef = useRef<MapView>(null);

  // Selected destination state
  const [selectedCoords, setSelectedCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [selectedName, setSelectedName] = useState<string>('');
  const [selectedAddress, setSelectedAddress] = useState<string>('');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlacePrediction[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Room generation state
  const [generatedRoom, setGeneratedRoom] = useState<CreatedRoomData | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Debounced search
  const handleSearchTextChange = useCallback((text: string) => {
    setSearchQuery(text);

    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }

    if (text.trim().length < 2) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    setIsSearching(true);
    setShowResults(true);

    searchTimeout.current = setTimeout(async () => {
      const results = await searchPlaces(text.trim());
      setSearchResults(results);
      setIsSearching(false);
    }, 400);
  }, []);

  // Handle selecting a search result
  const handleSelectSearchResult = async (prediction: PlacePrediction) => {
    Keyboard.dismiss();
    setShowResults(false);
    setSearchQuery(
      prediction.structured_formatting?.main_text || prediction.description,
    );

    const details = await getPlaceDetails(prediction.place_id);
    if (details) {
      setSelectedCoords({ latitude: details.latitude, longitude: details.longitude });
      setSelectedName(details.name);
      setSelectedAddress(details.address);

      // Animate map to the selected location
      mapRef.current?.animateToRegion(
        {
          latitude: details.latitude,
          longitude: details.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        600,
      );
    } else {
      Alert.alert('Location Error', 'Could not retrieve location details. Try selecting on the map instead.');
    }
  };

  // Handle tapping on the map
  const handleMapPress = async (event: any) => {
    const coordinate = event.nativeEvent?.coordinate;
    if (!coordinate) return;

    Keyboard.dismiss();
    setShowResults(false);

    setSelectedCoords({
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
    });
    setSelectedName('');
    setSelectedAddress('');

    // Try reverse geocoding (non-blocking — coordinates are stored regardless)
    const address = await reverseGeocode(coordinate.latitude, coordinate.longitude);
    if (address) {
      setSelectedAddress(address);
      // Extract a short name from the address
      const parts = address.split(',');
      setSelectedName(parts[0]?.trim() || '');
    }
  };

  // Create room with selected destination
  const handleConfirmDestination = async () => {
    if (!selectedCoords) {
      Alert.alert('No Destination', 'Please select a destination on the map or search for a location.');
      return;
    }

    if (!isOnline) {
      Alert.alert('Offline', 'Creating a ride requires a live connection. Please reconnect and try again.');
      return;
    }

    setIsCreating(true);

    try {
      const label = selectedName || selectedAddress || `${selectedCoords.latitude.toFixed(4)}, ${selectedCoords.longitude.toFixed(4)}`;

      const response = await fetch(`${apiBaseUrl}/api/rooms`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: {
            latitude: selectedCoords.latitude,
            longitude: selectedCoords.longitude,
            label: label.slice(0, 255),
          },
        }),
      });

      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to create ride room');

      const finalDest: RideDestination = {
        title: selectedName || label,
        locationName: selectedAddress || label,
        latitude: selectedCoords.latitude,
        longitude: selectedCoords.longitude,
      };

      setGeneratedRoom({
        groupCode: body.group_code,
        shareableUrl: body.group_code,
        destination: finalDest,
        creatorName,
      });
    } catch (error) {
      Alert.alert(
        'Create Ride Failed',
        error instanceof Error ? error.message : 'Unable to create ride room.',
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleNativeShare = async () => {
    if (!generatedRoom) return;
    try {
      await Share.share({
        title: `Join my ride to ${generatedRoom.destination.title}`,
        message:
          `🏍️ Join my ride group on Guardian Angel!\n` +
          `Destination: ${generatedRoom.destination.title}\n` +
          `Group Code: ${generatedRoom.groupCode}\n\n` +
          `Join link: ${generatedRoom.shareableUrl}`,
        url: generatedRoom.shareableUrl,
      });
    } catch {
      Alert.alert('Share Error', 'Could not open native share sheet.');
    }
  };

  // Format coordinates for display
  const coordsDisplay = selectedCoords
    ? `${selectedCoords.latitude.toFixed(5)}, ${selectedCoords.longitude.toFixed(5)}`
    : '';

  // ──────────────────────────────────────────
  // ROOM CREATED VIEW
  // ──────────────────────────────────────────
  if (generatedRoom) {
    return (
      <SafeAreaView style={styles.shell}>
        <View style={styles.roomCreatedContainer}>
          <View style={styles.roomCreatedCard}>
            <View style={styles.successBadgeRow}>
              <Text style={styles.successBadge}>✓ ROOM CREATED</Text>
              <Text style={styles.autoMemberTag}>AUTO-ADDED AS LEAD</Text>
            </View>

            <Text style={styles.destTitle}>
              🏁 {generatedRoom.destination.title}
            </Text>
            {generatedRoom.destination.locationName !== generatedRoom.destination.title && (
              <Text style={styles.destSub}>{generatedRoom.destination.locationName}</Text>
            )}

            <View style={styles.codeBox}>
              <Text style={styles.codeBoxLabel}>YOUR RIDE ROOM GROUP CODE</Text>
              <Text style={styles.codeBoxCode}>{generatedRoom.groupCode}</Text>
              <Text style={styles.codeBoxSub}>Share this code with riders joining manually.</Text>
            </View>

            <Pressable onPress={handleNativeShare} style={styles.shareSheetBtn}>
              <Text style={styles.shareSheetBtnText}>📱 Share Ride Code</Text>
            </Pressable>

            <View style={styles.rosterCard}>
              <Text style={styles.rosterTitle}>Room Members (1 Rider)</Text>
              <View style={styles.rosterMemberRow}>
                <View style={styles.leadDot} />
                <Text style={styles.rosterMemberName}>
                  {generatedRoom.creatorName} (Host)
                </Text>
                <Text style={styles.leadBadge}>LEAD</Text>
              </View>
            </View>

            <Pressable
              onPress={() => onConfirmAndStartRide(generatedRoom)}
              style={styles.startTrackingBtn}
            >
              <Text style={styles.startTrackingBtnText}>
                Start Live Group Tracking Map →
              </Text>
            </Pressable>
          </View>

          <Pressable onPress={onCancel} style={styles.cancelBtnSmall}>
            <Text style={styles.cancelBtnSmallText}>← Back to Portal</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ──────────────────────────────────────────
  // MAP-FIRST DESTINATION PICKER
  // ──────────────────────────────────────────
  return (
    <SafeAreaView style={styles.shell}>
      <View style={styles.mapContainer}>
        {/* Full-screen Google Map */}
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={styles.fullMap}
          initialRegion={DEFAULT_REGION}
          showsUserLocation={true}
          showsMyLocationButton={false}
          showsCompass={true}
          mapType="standard"
          onPress={handleMapPress}
        >
          {selectedCoords && (
            <Marker
              coordinate={selectedCoords}
              title={selectedName || 'Selected Destination'}
              description={selectedAddress || coordsDisplay}
              pinColor="red"
            />
          )}
        </MapView>

        {/* ── TOP BAR: Back + Search ── */}
        <View style={styles.topBar}>
          <Pressable onPress={onCancel} style={styles.backBtn}>
            <Text style={styles.backBtnText}>←</Text>
          </Pressable>
          <View style={styles.searchContainer}>
            <TextInput
              value={searchQuery}
              onChangeText={handleSearchTextChange}
              placeholder="Search destination..."
              placeholderTextColor="#5C7062"
              style={styles.searchInput}
              returnKeyType="search"
              onFocus={() => {
                if (searchResults.length > 0) setShowResults(true);
              }}
            />
            {searchQuery.length > 0 && (
              <Pressable
                onPress={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                  setShowResults(false);
                }}
                style={styles.clearSearchBtn}
              >
                <Text style={styles.clearSearchBtnText}>✕</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* ── SEARCH RESULTS DROPDOWN ── */}
        {showResults && (
          <View style={styles.searchResultsContainer}>
            {isSearching ? (
              <View style={styles.searchResultItem}>
                <Text style={styles.searchResultText}>Searching...</Text>
              </View>
            ) : searchResults.length === 0 ? (
              <View style={styles.searchResultItem}>
                <Text style={styles.searchResultText}>No results found</Text>
              </View>
            ) : (
              <FlatList
                data={searchResults.slice(0, 5)}
                keyExtractor={item => item.place_id}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.searchResultItem}
                    onPress={() => handleSelectSearchResult(item)}
                  >
                    <Text style={styles.searchResultMainText}>
                      {item.structured_formatting?.main_text || item.description}
                    </Text>
                    {item.structured_formatting?.secondary_text && (
                      <Text style={styles.searchResultSubText}>
                        {item.structured_formatting.secondary_text}
                      </Text>
                    )}
                  </Pressable>
                )}
              />
            )}
          </View>
        )}

        {/* ── BOTTOM PANEL: Selected destination + Confirm ── */}
        <View style={styles.bottomPanel}>
          {selectedCoords ? (
            <>
              <View style={styles.selectedDestInfo}>
                <Text style={styles.selectedDestLabel}>📍 DESTINATION</Text>
                <Text style={styles.selectedDestName} numberOfLines={1}>
                  {selectedName || 'Selected Location'}
                </Text>
                {selectedAddress ? (
                  <Text style={styles.selectedDestAddress} numberOfLines={2}>
                    {selectedAddress}
                  </Text>
                ) : null}
                <Text style={styles.selectedDestCoords}>{coordsDisplay}</Text>
              </View>

              <Pressable
                onPress={handleConfirmDestination}
                style={[styles.confirmBtn, isCreating && styles.confirmBtnDisabled]}
                disabled={isCreating}
              >
                <Text style={styles.confirmBtnText}>
                  {isCreating ? 'Creating Room...' : 'Confirm Destination & Create Room →'}
                </Text>
              </Pressable>
            </>
          ) : (
            <View style={styles.promptContainer}>
              <Text style={styles.promptText}>
                Tap the map or search to select a destination
              </Text>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────
// STYLES
// ──────────────────────────────────────────

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: COLORS.ink },

  // Map container
  mapContainer: { flex: 1 },
  fullMap: { ...StyleSheet.absoluteFillObject },

  // Top bar
  topBar: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 10,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(11, 19, 14, 0.95)',
    borderColor: COLORS.line,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backBtnText: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '800',
  },
  searchContainer: {
    flex: 1,
    position: 'relative',
  },
  searchInput: {
    backgroundColor: 'rgba(11, 19, 14, 0.95)',
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    color: COLORS.text,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingRight: 40,
    height: 44,
  },
  clearSearchBtn: {
    position: 'absolute',
    right: 12,
    top: 12,
    padding: 2,
  },
  clearSearchBtnText: {
    color: COLORS.muted,
    fontSize: 16,
    fontWeight: '700',
  },

  // Search results dropdown
  searchResultsContainer: {
    position: 'absolute',
    top: 64,
    left: 64,
    right: 12,
    backgroundColor: 'rgba(11, 19, 14, 0.98)',
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    maxHeight: 250,
    zIndex: 20,
    overflow: 'hidden',
  },
  searchResultItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  searchResultText: {
    color: COLORS.muted,
    fontSize: 13,
  },
  searchResultMainText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  searchResultSubText: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 2,
  },

  // Bottom panel
  bottomPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(11, 19, 14, 0.97)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: COLORS.line,
    padding: 16,
    gap: 12,
  },
  selectedDestInfo: {
    gap: 4,
  },
  selectedDestLabel: {
    color: COLORS.green,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  selectedDestName: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '800',
  },
  selectedDestAddress: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  selectedDestCoords: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  confirmBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmBtnDisabled: {
    opacity: 0.6,
  },
  confirmBtnText: {
    color: COLORS.ink,
    fontWeight: '900',
    fontSize: 15,
    letterSpacing: 0.2,
  },
  promptContainer: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  promptText: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: '600',
  },

  // Room created view
  roomCreatedContainer: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    gap: 16,
  },
  roomCreatedCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    gap: 16,
  },
  successBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  successBadge: {
    color: COLORS.green,
    backgroundColor: '#0E2A18',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  autoMemberTag: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '700',
  },
  destTitle: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '800',
  },
  destSub: {
    color: COLORS.muted,
    fontSize: 13,
    marginTop: -10,
  },
  codeBox: {
    backgroundColor: '#0F1E14',
    borderColor: '#224830',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  codeBoxLabel: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  codeBoxCode: {
    color: COLORS.text,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 4,
  },
  codeBoxSub: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 2,
  },
  shareSheetBtn: {
    backgroundColor: COLORS.blue,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  shareSheetBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  rosterCard: {
    backgroundColor: COLORS.darkInput,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  rosterTitle: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  rosterMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  leadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.green,
  },
  rosterMemberName: {
    flex: 1,
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  leadBadge: {
    color: COLORS.green,
    fontSize: 9,
    fontWeight: '800',
    backgroundColor: '#0F2918',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  startTrackingBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  startTrackingBtnText: {
    color: COLORS.ink,
    fontWeight: '900',
    fontSize: 15,
    letterSpacing: 0.2,
  },
  cancelBtnSmall: {
    alignSelf: 'center',
    paddingVertical: 8,
  },
  cancelBtnSmallText: {
    color: COLORS.blue,
    fontSize: 14,
    fontWeight: '700',
  },
});

export default CreateRideDestinationScreen;
