import { AlertCircle, Loader2, Plus } from "lucide-react";
import { t } from "../i18n";

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
					<label>{t("playlists.addByUrl")}</label>
			</div>

			<div className="add-playlist-form__content">
				<div className="add-playlist-form__input-group">
					<label htmlFor="playlist-id-input">
						{t("playlists.enterIdUrl")}
					</label>
					<div className="add-playlist-form__input-wrapper">
						<input
							id="playlist-id-input"
							autoFocus
							type="text"
							className="add-playlist-form__input"
							placeholder={t("playlists.idUrlPlaceholder")}
							value={playlistIdInput}
							onChange={(e) => setPlaylistIdInput(e.target.value)}
							disabled={isAdding}
							onKeyDown={(e) => {
								if (e.nativeEvent.isComposing) return;
								if (e.key === "Enter") {
									e.preventDefault();
									handleAddPlaylist();
								}
								if (e.key === "Escape") {
									e.preventDefault();
									e.stopPropagation();
									resetAddForm();
								}
							}}
						/>
					</div>
				</div>

				{addError && (
					<div className="add-playlist-form__error" role="alert">
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
								{t("playlists.adding")}
							</>
						) : (
							<>
								<Plus size={16} />
								{t("playlists.addPlaylist")}
							</>
						)}
					</button>
					<button
						className="add-playlist-form__cancel"
						onClick={resetAddForm}
						disabled={isAdding}
					>
						{t("settings.cancel")}
					</button>
				</div>
			</div>
		</div>
	);
};
