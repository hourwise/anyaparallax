/** Pure public grouping for optional gallery series. */
export type GallerySeriesDescriptor = {
  readonly id: string;
  readonly title: string;
};

export type SeriesAssignablePhoto = {
  readonly seriesId: string | null;
};

export type GalleryPhotoGroup<TPhoto extends SeriesAssignablePhoto> = {
  readonly id: string;
  readonly title: string | null;
  readonly photos: readonly TPhoto[];
};

/**
 * No configured series means one title-free flat grid. With series, configured
 * groups retain their order and unassigned photographs form a neutral final
 * “More” group only when one is actually needed.
 */
export function groupGalleryPhotos<TPhoto extends SeriesAssignablePhoto>(
  series: readonly GallerySeriesDescriptor[],
  photos: readonly TPhoto[],
): readonly GalleryPhotoGroup<TPhoto>[] {
  if (series.length === 0) {
    return [{ id: "all", title: null, photos }];
  }
  return [
    ...series.map((item) => ({
      id: item.id,
      title: item.title,
      photos: photos.filter((photo) => photo.seriesId === item.id),
    })),
    {
      id: "unassigned",
      title: "More",
      photos: photos.filter((photo) => photo.seriesId === null),
    },
  ].filter((group) => group.photos.length > 0);
}
