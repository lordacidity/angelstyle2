// What /api/photos/search returns: free-to-use photos of a person, one source per request. Client-safe: no server
// imports. Shown by the Pricer's photo panel (components/pricer/PricerPhotos) and the Photos section
// (components/photos/PhotosSection), which share the crop and grid in components/photos.

export type PhotoSource = 'wikimedia' | 'openverse';

export interface FreePhoto {
  id: string;
  source: 'Wikimedia Commons' | 'Openverse';
  provider?: string;        // Openverse only: where the photo actually lives (flickr, …)
  title: string;
  thumb: string;            // ~400px wide, for the grid
  full: string;             // up to 1920px wide, what the crop is cut from
  width: number;            // of the original file
  height: number;
  license: string;          // "CC BY-SA 4.0", "CC0", "Public domain"
  licenseUrl: string;
  creator: string;
  page: string;             // the file's own page, where the licence can be checked
}

export interface PhotosResponse { query: string; source: PhotoSource; photos: FreePhoto[] }
