'use client'

import Image from 'next/image';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { StepperProvider, useStepper } from '@/components/StepperContext';
import QuoteStepper from '@/components/QuoteStepper';
import QuoteHeader from '@/components/QuoteHeader';
import { QUOTE_CONSTANTS } from '@/lib/constants';

const COST_PER_KM = QUOTE_CONSTANTS.COST_PER_KM;
const MARGIN = QUOTE_CONSTANTS.MARGIN;

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';

const NOMINATIM_HEADERS = {
  'Accept-Language': 'en',
  'User-Agent': 'DelicateCourierQuoteGenerator/1.0 (contact@delicatecourier.co.za)'
};

const DEPOT_COORDS: [number, number] = [-25.765757, 28.288375];

// Haversine formula for straight-line distance in km
function haversineDistance(coord1: [number, number], coord2: [number, number]): number {
  const R = 6371; // Earth radius in km
  const [lat1, lon1] = coord1;
  const [lat2, lon2] = coord2;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

async function geocodeAddress(address: string): Promise<[number, number] | null> {
  if (!address?.trim()) return null;
  
  const params = new URLSearchParams({ 
    q: address.trim(), 
    format: 'json', 
    limit: '1' 
  });

  try {
    const res = await fetch(`${NOMINATIM_SEARCH_URL}?${params}`, { 
      headers: NOMINATIM_HEADERS 
    });
    const data = await res.json();
    return data.length > 0 
      ? [parseFloat(data[0].lat), parseFloat(data[0].lon)] as [number, number] 
      : null;
  } catch {
    return null;
  }
}

async function getOSRMRoute(coords: [number, number][]) {
  const coordsStr = coords.map(([lat, lon]) => `${lon},${lat}`).join(';');
  const url = `${OSRM_URL}/${coordsStr}?overview=full&geometries=geojson&steps=true&annotations=distance`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM returned error: ${res.status}`);
    
    const data = await res.json();
    if (data.code !== 'Ok') throw new Error(data.message || data.code || 'Routing failed');
    
    return data;
  } catch (e) {
    throw new Error(`Route calculation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function AutocompleteInput({ 
  value, 
  onChange, 
  placeholder 
}: { 
  value: string; 
  onChange: (v: string) => void; 
  placeholder?: string;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!value.trim()) {
      setSuggestions([]);
      return;
    }

    clearTimeout(timerRef.current!);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: value.trim(), format: 'json', limit: '5' });
        const res = await fetch(`${NOMINATIM_SEARCH_URL}?${params}`, { headers: NOMINATIM_HEADERS });
        const data = await res.json();
        setSuggestions(data.map((i: any) => i.display_name));
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => clearTimeout(timerRef.current!);
  }, [value]);

  return (
    <div className="relative flex-1">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setShow(true)}
        onBlur={() => setTimeout(() => setShow(false), 200)}
        placeholder={placeholder}
        className="w-full border rounded-lg p-2"
      />
      {show && suggestions.length > 0 && (
        <div className="absolute z-20 w-full mt-1 bg-white border rounded shadow-lg max-h-60 overflow-y-auto">
          {loading ? (
            <div className="p-2 text-sm text-gray-500">Searching...</div>
          ) : (
            suggestions.map((s, i) => (
              <div 
                key={i} 
                onMouseDown={() => { onChange(s); setShow(false); }}
                className="p-2 cursor-pointer hover:bg-gray-100 text-sm border-b last:border-0"
              >
                {s}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface AddressDetailsProps {
  address: string; setAddress: (v: string) => void;
  building: string; setBuilding: (v: string) => void;
  suburb: string; setSuburb: (v: string) => void;
  city: string; setCity: (v: string) => void;
  province: string; setProvince: (v: string) => void;
  postalCode: string; setPostalCode: (v: string) => void;
  addressType: string; setAddressType: (v: string) => void;
}

function AddressDetails({
  address, setAddress,
  building, setBuilding,
  suburb, setSuburb,
  city, setCity,
  province, setProvince,
  postalCode, setPostalCode,
  addressType, setAddressType
}: AddressDetailsProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">Address Type</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAddressType('residential')}
            className={`flex-1 py-2 rounded-xl border transition-colors ${
              addressType === 'residential' 
                ? 'bg-[#E84A8A] text-white border-[#ECEAE6]' 
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            Residential
          </button>
          <button
            type="button"
            onClick={() => setAddressType('business')}
            className={`flex-1 py-2 rounded-xl border transition-colors ${
              addressType === 'business' 
                ? 'bg-[#E84A8A] text-white border-[#ECEAE6]' 
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            Business
          </button>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">
          {addressType === 'business' ? 'Company Name' : 'Building / Floor / Unit'}
        </label>
        <input 
          type="text" 
          value={building} 
          onChange={(e) => setBuilding(e.target.value)} 
          placeholder={addressType === 'business' ? 'Company name' : 'Floor 2, Unit 4'} 
          className="w-full border rounded-lg p-2" 
        />
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">Street Address</label>
        <AutocompleteInput 
          value={address} 
          onChange={setAddress} 
          placeholder="Enter street address" 
        />
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">Suburb</label>
        <input 
          type="text" 
          value={suburb} 
          onChange={(e) => setSuburb(e.target.value)} 
          placeholder="Lynnwood Ridge" 
          className="w-full border rounded-lg p-2" 
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">City</label>
          <input 
            type="text" 
            value={city} 
            onChange={(e) => setCity(e.target.value)} 
            placeholder="Pretoria" 
            className="w-full border rounded-lg p-2" 
          />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Province</label>
          <select 
            value={province} 
            onChange={(e) => setProvince(e.target.value)} 
            className="w-full border rounded-lg p-2 bg-white"
          >
            <option value="">Select province</option>
            <option value="Gauteng">Gauteng</option>
            <option value="Western Cape">Western Cape</option>
            <option value="KwaZulu-Natal">KwaZulu-Natal</option>
            <option value="Eastern Cape">Eastern Cape</option>
            <option value="Free State">Free State</option>
            <option value="Limpopo">Limpopo</option>
            <option value="Mpumalanga">Mpumalanga</option>
            <option value="North West">North West</option>
            <option value="Northern Cape">Northern Cape</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">Postal Code</label>
        <input 
          type="text" 
          value={postalCode} 
          onChange={(e) => setPostalCode(e.target.value)} 
          placeholder="0040" 
          className="w-full border rounded-lg p-2" 
        />
      </div>
    </div>
  );
}

type Dropoff = {
  id: number;
  name: string;
  address: string;
  building: string;
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
  addressType: string;
  coords: [number, number] | null;
};

// ── Separate component that uses useStepper ────────────────────────────────────────
function Step1Content() {
  const router = useRouter();
  const { markStepCompleted } = useStepper();

  // Pickup States
  const [pickupName, setPickupName] = useState("Pickup");
  const [pickupAddress, setPickupAddress] = useState("");
  const [pickupBuilding, setPickupBuilding] = useState("");
  const [pickupSuburb, setPickupSuburb] = useState("");
  const [pickupCity, setPickupCity] = useState("");
  const [pickupProvince, setPickupProvince] = useState("");
  const [pickupPostalCode, setPickupPostalCode] = useState("");
  const [pickupAddressType, setPickupAddressType] = useState("residential");
  const [pickupCoords, setPickupCoords] = useState<[number, number] | null>(null);
  // Pre-configured collection point from a client link (locks the collection card).
  const [presetCollection, setPresetCollection] = useState<{ name: string; address: string; lat: number; lng: number } | null>(null);

  // Dropoffs
  const [dropoffs, setDropoffs] = useState<Dropoff[]>([{
    id: 1,
    name: "Dropoff 1",
    address: "",
    building: "",
    suburb: "",
    city: "",
    province: "",
    postalCode: "",
    addressType: "residential",
    coords: null
  }]);

  // Route States
  const [routeCalculated, setRouteCalculated] = useState(false);
  const [routeCalcLoading, setRouteCalcLoading] = useState(false);
  const [totalDistance, setTotalDistance] = useState(0);
  const [error, setError] = useState("");

  // Capture the client-link token; if the link has a pre-set collection address,
  // pre-fill and lock the collection so the client only enters a delivery address.
  useEffect(() => {
    let token: string | null = null;
    try {
      token = new URLSearchParams(window.location.search).get('c');
      if (token) localStorage.setItem('quoteClientToken', token);
      else token = localStorage.getItem('quoteClientToken');
    } catch {}
    if (!token) return;
    fetch(`/api/rate-context/?c=${encodeURIComponent(token)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d && d.has_preset_collection && d.collection_lat != null && d.collection_lng != null) {
          setPresetCollection({ name: d.collection_name || 'Pickup', address: d.collection_address, lat: d.collection_lat, lng: d.collection_lng });
          setPickupName(d.collection_name || 'Pickup');
          setPickupAddress(d.collection_address || '');
          setPickupCoords([d.collection_lat, d.collection_lng]);
        }
      })
      .catch(() => {});
  }, []);

  const depotCoords: [number, number] = DEPOT_COORDS;

  const getNextId = () => Math.max(...dropoffs.map(d => d.id), 0) + 1;

  const addDropoff = () => {
    const newId = getNextId();
    setDropoffs(prev => [...prev, {
      id: newId,
      name: `Dropoff ${newId}`,
      address: "",
      building: "",
      suburb: "",
      city: "",
      province: "",
      postalCode: "",
      addressType: "residential",
      coords: null
    }]);
  };

  const removeDropoff = (id: number) => {
    if (dropoffs.length > 1) {
      setDropoffs(prev => prev.filter(d => d.id !== id));
      setRouteCalculated(false);
    }
  };

  const updateDropoff = (id: number, field: string, value: any) => {
    setDropoffs(prev => prev.map(d => 
      d.id === id ? { ...d, [field]: value } : d
    ));
    if (field === 'address') {
      setRouteCalculated(false);
    }
  };

  // Geocode Pickup
  useEffect(() => {
    if (!pickupAddress.trim()) {
      setPickupCoords(null);
      return;
    }
    setRouteCalculated(false);

    const timer = setTimeout(async () => {
      const coords = await geocodeAddress(pickupAddress);
      if (coords) setPickupCoords(coords);
    }, 800);

    return () => clearTimeout(timer);
  }, [pickupAddress]);

  // Geocode Dropoffs
  const dropoffAddressKey = useMemo(() => 
    dropoffs.map(d => d.address).join(','), 
    [dropoffs]
  );

  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    dropoffs.forEach((dropoff) => {
      if (!dropoff.address.trim()) {
        setDropoffs(prev => prev.map(d => 
          d.id === dropoff.id ? { ...d, coords: null } : d
        ));
        return;
      }

      const capturedId = dropoff.id;
      const timer = setTimeout(async () => {
        const coords = await geocodeAddress(dropoff.address);
        if (coords) {
          setDropoffs(prev => prev.map(d => 
            d.id === capturedId ? { ...d, coords } : d
          ));
        }
      }, 1000);

      timers.push(timer);
    });

    return () => timers.forEach(clearTimeout);
  }, [dropoffAddressKey]);

  const calculateRoute = async (): Promise<boolean> => {
    if (!pickupCoords) {
      setError("Please enter a valid pickup address");
      return false;
    }

    const validDropoffs = dropoffs.filter(d => d.coords);
    
    if (validDropoffs.length === 0) {
      setError("Please enter at least one valid dropoff address");
      return false;
    }

    setRouteCalcLoading(true);
    setError("");

    try {
      let totalDistance = 0;
      const allPoints: [number, number][] = [depotCoords, pickupCoords];
      
      validDropoffs.forEach(d => {
        if (d.coords) allPoints.push(d.coords);
      });
      allPoints.push(depotCoords);

      for (let i = 0; i < allPoints.length - 1; i++) {
        totalDistance += haversineDistance(allPoints[i], allPoints[i + 1]);
      }

      const finalDistance = Math.max(parseFloat(totalDistance.toFixed(2)), 5);
      setTotalDistance(finalDistance);
      setRouteCalculated(true);
      return true;
    } catch (e) {
      setError(`Could not calculate route: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setRouteCalcLoading(false);
    }
  };

  const handleNext = async () => {
    if (routeCalculated) {
      const routeData = {
        pickup: {
          name: pickupName,
          address: pickupAddress,
          building: pickupBuilding,
          suburb: pickupSuburb,
          city: pickupCity,
          province: pickupProvince,
          postalCode: pickupPostalCode,
          addressType: pickupAddressType,
          coords: pickupCoords
        },
        dropoffs: dropoffs.map(d => ({
          id: d.id,
          name: d.name,
          address: d.address,
          building: d.building,
          suburb: d.suburb,
          city: d.city,
          province: d.province,
          postalCode: d.postalCode,
          addressType: d.addressType,
          coords: d.coords
        })),
        totalDistance,
        routeCalculated: true
      };

      localStorage.setItem('quoteRouteData', JSON.stringify(routeData));
      localStorage.setItem('quoteStep1Complete', 'true');
      markStepCompleted(1);
      router.push('/quote/step2');
      return;
    }

    const success = await calculateRoute();
    if (success) {
      const routeData = {
        pickup: {
          name: pickupName,
          address: pickupAddress,
          building: pickupBuilding,
          suburb: pickupSuburb,
          city: pickupCity,
          province: pickupProvince,
          postalCode: pickupPostalCode,
          addressType: pickupAddressType,
          coords: pickupCoords
        },
        dropoffs: dropoffs.map(d => ({
          id: d.id,
          name: d.name,
          address: d.address,
          building: d.building,
          suburb: d.suburb,
          city: d.city,
          province: d.province,
          postalCode: d.postalCode,
          addressType: d.addressType,
          coords: d.coords
        })),
        totalDistance,
        routeCalculated: true
      };

      localStorage.setItem('quoteRouteData', JSON.stringify(routeData));
      localStorage.setItem('quoteStep1Complete', 'true');
      markStepCompleted(1);
      router.push('/quote/step2');
    }
  };

  return (
    <>
      <QuoteHeader />

      <main className="flex-1 max-w-6xl mx-auto w-full pt-6 px-4 pb-20">
        <QuoteStepper />

        <h2 className="text-2xl font-semibold mb-6">Route</h2>

        {/* Responsive grid: side‑by‑side on md+, stacked on mobile */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 items-start">
          {/* Collection Card */}
          <div className="bg-white border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-green-200 rounded-full flex items-center justify-center">
                <Image 
                  src="/icons/delivery-truck.png" 
                  alt="icon" 
                  width={20} 
                  height={20} 
                  className="w-5 h-5"
                />
              </div>
              <h3 className="font-semibold">Collection</h3>
            </div>
            {presetCollection ? (
              <div className="space-y-2">
                <div className="border rounded-lg p-3 bg-gray-50">
                  <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Collection point</p>
                  <p className="font-medium">{presetCollection.name}</p>
                  <p className="text-sm text-gray-700">{presetCollection.address}</p>
                </div>
                <p className="text-xs text-gray-500">Set for your account. Just add your delivery address below.</p>
              </div>
            ) : (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Name</label>
                <input 
                  type="text" 
                  value={pickupName} 
                  onChange={(e) => setPickupName(e.target.value)} 
                  className="w-full border rounded-lg p-2" 
                />
              </div>
              <AddressDetails
                address={pickupAddress} setAddress={setPickupAddress}
                building={pickupBuilding} setBuilding={setPickupBuilding}
                suburb={pickupSuburb} setSuburb={setPickupSuburb}
                city={pickupCity} setCity={setPickupCity}
                province={pickupProvince} setProvince={setPickupProvince}
                postalCode={pickupPostalCode} setPostalCode={setPickupPostalCode}
                addressType={pickupAddressType} setAddressType={setPickupAddressType}
              />
            </div>
            )}
          </div>

          {/* Delivery Card */}
          <div className="bg-white border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-green-200 rounded-full flex items-center justify-center">
                <Image 
                  src="/icons/delivery-truck.png" 
                  alt="icon" 
                  width={20} 
                  height={20} 
                  className="w-5 h-5"
                />
              </div>
              <h3 className="font-semibold">Delivery</h3>
            </div>

            <div className="space-y-6">
              {dropoffs.map((dropoff) => (
                <div key={dropoff.id} className="border-t pt-4 first:border-t-0 first:pt-0">
                  <div className="flex justify-between items-start mb-3">
                    <label className="text-sm font-medium text-gray-700">Name</label>
                    {dropoffs.length > 1 && (
                      <button 
                        type="button" 
                        onClick={() => removeDropoff(dropoff.id)} 
                        className="text-red-500 text-sm hover:text-red-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <input 
                    type="text" 
                    value={dropoff.name} 
                    onChange={(e) => updateDropoff(dropoff.id, 'name', e.target.value)} 
                    className="w-full border rounded-lg p-2 mb-3" 
                  />
                  <AddressDetails
                    address={dropoff.address} 
                    setAddress={(v) => updateDropoff(dropoff.id, 'address', v)}
                    building={dropoff.building} 
                    setBuilding={(v) => updateDropoff(dropoff.id, 'building', v)}
                    suburb={dropoff.suburb} 
                    setSuburb={(v) => updateDropoff(dropoff.id, 'suburb', v)}
                    city={dropoff.city} 
                    setCity={(v) => updateDropoff(dropoff.id, 'city', v)}
                    province={dropoff.province} 
                    setProvince={(v) => updateDropoff(dropoff.id, 'province', v)}
                    postalCode={dropoff.postalCode} 
                    setPostalCode={(v) => updateDropoff(dropoff.id, 'postalCode', v)}
                    addressType={dropoff.addressType} 
                    setAddressType={(v) => updateDropoff(dropoff.id, 'addressType', v)}
                  />
                </div>
              ))}
            </div>

            <button 
              type="button" 
              onClick={addDropoff} 
              className="mt-4 text-sm text-[#E84A8A] hover:text-[#E84A8A] font-medium"
            >
              + Add another dropoff
            </button>
          </div>
        </div>

        {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}

        <button 
          type="button"
          onClick={handleNext}
          disabled={routeCalcLoading || !pickupAddress.trim()}
          className="w-full bg-[#E84A8A] text-white py-3 rounded-xl font-medium hover:bg-[#E84A8A] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {routeCalcLoading ? "CALCULATING ROUTE..." : "Next"}
        </button>
      </main>
    </>
  );
}

// ── Main Page ────────────────────────────────────────────────────
export default function Step1Page() {
  return (
    <StepperProvider currentStep={1}>
      <div className="flex flex-col min-h-screen">
        <Step1Content />
      </div>
    </StepperProvider>
  );
}