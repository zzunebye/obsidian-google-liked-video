import { AlertCircle, Loader2, Plus } from "lucide-react";

interface AddPlaylistFormProps {
	resetAddForm: () => void;
	isAdding: boolean;
	playlistIdInput: string;
	setPlaylistIdInput: (value: string) => void;
	handleAddPlaylist: () => void;
	addError: string | null;
}

export const AddPlaylistForm = ({
	resetAddForm,
	isAdding,
	playlistIdInput,
	setPlaylistIdInput,
	handleAddPlaylist,
	addError,
}: AddPlaylistFormProps) => {
	return (
		<div className="add-playlist-form">
			<div className="add-playlist-form__header">
				<label>Add Playlist by ID</label>
			</div>

			<div className="add-playlist-form__content">
				<div className="add-playlist-form__input-group">
					<label htmlFor="playlist-id-input">
						Playlist ID or URL:
					</label>
					<div className="add-playlist-form__input-wrapper">
						<input
							id="playlist-id-input"
							type="text"
							className="add-playlist-form__input"
							placeholder="PLDDTZzm0d6OE3op3... or full YouTube URL"
							value={playlistIdInput}
							onChange={(e) => setPlaylistIdInput(e.target.value)}
							disabled={isAdding}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									handleAddPlaylist();
								}
								if (e.key === "Escape") {
									resetAddForm();
								}
							}}
						/>
					</div>
				</div>

				{addError && (
					<div className="add-playlist-form__error">
						<AlertCircle size={16} />
						{addError}
					</div>
				)}

				<div className="add-playlist-form__actions">
					<button
						className="add-playlist-form__submit"
						onClick={handleAddPlaylist}
						disabled={isAdding || !playlistIdInput.trim()}
					>
						{isAdding ? (
							<>
								<Loader2 size={16} className="animate-spin" />
								Adding...
							</>
						) : (
							<>
								<Plus size={16} />
								Add Playlist
							</>
						)}
					</button>
					<button
						className="add-playlist-form__cancel"
						onClick={resetAddForm}
						disabled={isAdding}
					>
						Cancel
					</button>
				</div>
			</div>
		</div>
	);
};
