import React, { useState, useEffect } from 'react';

function PhotoReportEditor({
    initialPhotos,
    downloadImages,
    isEditing,
    editedHeader = '',
    editedFooter = '',
    onPhotosChange,
    onHeaderChange,
    onFooterChange
}) {
    const [photos, setPhotos] = useState(initialPhotos);
    const [base64Images, setBase64Images] = useState({});
    const [loading, setLoading] = useState(true);
    const [header, setHeader] = useState(editedHeader);
    const [footer, setFooter] = useState(editedFooter);

    // État local pour le texte brut pendant l'édition
    const [editingTexts, setEditingTexts] = useState({});

    useEffect(() => {
        loadImages();
    }, [initialPhotos]);

    useEffect(() => {
        setHeader(editedHeader);
    }, [editedHeader]);

    useEffect(() => {
        setFooter(editedFooter);
    }, [editedFooter]);

    useEffect(() => {
        setPhotos(initialPhotos);
        // Initialiser les textes d'édition
        const texts = {};
        initialPhotos.forEach(photo => {
            texts[`${photo.id}-observation`] = formatArrayToBullets(photo.analysis.observation);
            texts[`${photo.id}-recommendation`] = formatArrayToBullets(photo.analysis.recommendation);
            texts[`${photo.id}-references`] = formatArrayToBullets(photo.analysis.references);
        });
        setEditingTexts(texts);
    }, [initialPhotos]);

    // Notifier le parent des changements
    useEffect(() => {
        if (onPhotosChange) {
            onPhotosChange(photos);
        }
    }, [photos]);

    useEffect(() => {
        if (onHeaderChange) {
            onHeaderChange(header);
        }
    }, [header]);

    useEffect(() => {
        if (onFooterChange) {
            onFooterChange(footer);
        }
    }, [footer]);

    const loadImages = async () => {
        setLoading(true);
        try {
            const imagesMap = {};

            for (const photo of initialPhotos) {
                try {
                    const base64 = await downloadImages(photo.s3Url);
                    console.log(`Image chargée pour ${photo.id}:`, base64 ? 'OK' : 'VIDE');

                    if (base64) {
                        if (base64.startsWith('data:image')) {
                            imagesMap[photo.id] = base64;
                        } else {
                            imagesMap[photo.id] = `data:image/jpeg;base64,${base64}`;
                        }
                    }
                } catch (error) {
                    console.error(`Erreur chargement image ${photo.id}:`, error);
                }
            }

            console.log('Images chargées:', Object.keys(imagesMap).length);
            setBase64Images(imagesMap);
        } catch (error) {
            console.error('Erreur lors du chargement des images:', error);
        } finally {
            setLoading(false);
        }
    };

    const getRiskLevelLabel = (level) => {
        const levels = {
            'eleve': 'HIGH',
            'moyen': 'MEDIUM',
            'faible': 'LOW'
        };
        return levels[level] || level.toUpperCase();
    };

    const handleKeyDown = (e, photoId, field) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const textarea = e.target;
            const cursorPosition = textarea.selectionStart;
            const currentValue = textarea.value;

            const newValue =
                currentValue.substring(0, cursorPosition) +
                '\n• ' +
                currentValue.substring(cursorPosition);

            const key = `${photoId}-${field}`;
            setEditingTexts(prev => ({
                ...prev,
                [key]: newValue
            }));

            setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = cursorPosition + 3;
            }, 0);
        }
    };

    const handleTextChange = (e, photoId, field) => {
        const value = e.target.value;
        const key = `${photoId}-${field}`;

        setEditingTexts(prev => ({
            ...prev,
            [key]: value
        }));
    };

    const handleTextBlur = (photoId, field) => {
        const key = `${photoId}-${field}`;
        const value = editingTexts[key] || '';

        setPhotos(prevPhotos =>
            prevPhotos.map(photo => {
                if (photo.id === photoId) {
                    return {
                        ...photo,
                        analysis: {
                            ...photo.analysis,
                            [field]: value.split('\n')
                                .map(line => line.replace(/^•\s*/, '').trim())
                                .filter(line => line.length > 0)
                        }
                    };
                }
                return photo;
            })
        );
    };

    const handleCommentChange = (e, photoId) => {
        const value = e.target.value;
        setPhotos(prevPhotos =>
            prevPhotos.map(photo => {
                if (photo.id === photoId) {
                    return { ...photo, comment: value };
                }
                return photo;
            })
        );
    };

    const formatArrayToBullets = (arr) => {
        return arr.map(item => `• ${item}`).join('\n');
    };

    if (loading) {
        return <div style={{ padding: '20px' }}>Chargement des images...</div>;
    }

    return (
        <div style={{ padding: '20px' }}>
            {isEditing ? (
                /* Mode Édition */
                <div>
                    {/* Édition Header */}
                    <div style={{ marginBottom: '30px', border: '1px solid #ddd', borderRadius: '8px', padding: '20px', backgroundColor: '#f0f8ff' }}>
                        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                            📝 En-tête du rapport:
                        </label>
                        <textarea
                            value={header}
                            onChange={(e) => setHeader(e.target.value)}
                            placeholder="Ajouter un en-tête (optionnel)..."
                            style={{
                                width: '100%',
                                minHeight: '150px',
                                padding: '10px',
                                fontFamily: 'monospace',
                                fontSize: '14px',
                                borderRadius: '4px',
                                border: '1px solid #ccc',
                                resize: 'vertical'
                            }}
                        />
                    </div>

                    {/* Photos Section */}
                    <div style={{ marginBottom: '30px', padding: '15px', backgroundColor: '#fff3cd', borderRadius: '8px' }}>
                        <h3>OBSERVATIONS PRINCIPALES:</h3>
                    </div>

                    {photos.map((photo, index) => (
                        <div key={photo.id} style={{
                            marginBottom: '40px',
                            border: '2px solid #ddd',
                            borderRadius: '8px',
                            padding: '25px',
                            backgroundColor: '#f9f9f9'
                        }}>
                            <h3 style={{ marginBottom: '15px' }}>
                                Photo {index + 1} - Niveau de risque: {getRiskLevelLabel(photo.analysis.riskLevel)}
                            </h3>

                            {/* Image Base64 */}
                            <div style={{ marginBottom: '20px', textAlign: 'center' }}>
                                {base64Images[photo.id] ? (
                                    <img
                                        src={base64Images[photo.id]}
                                        alt={`Photo ${index + 1}`}
                                        style={{
                                            maxWidth: '800px',
                                            width: '100%',
                                            height: 'auto',
                                            borderRadius: '8px',
                                            boxShadow: '0 4px 8px rgba(0,0,0,0.15)',
                                            border: '2px solid #e0e0e0'
                                        }}
                                        onError={(e) => {
                                            console.error('Erreur chargement image:', photo.id);
                                            e.target.style.display = 'none';
                                        }}
                                    />
                                ) : (
                                    <div style={{
                                        padding: '20px',
                                        backgroundColor: '#f0f0f0',
                                        borderRadius: '8px',
                                        color: '#666'
                                    }}>
                                        Image en cours de chargement...
                                    </div>
                                )}
                                <p style={{ fontSize: '12px', color: '#666', marginTop: '8px', textAlign: 'left' }}>
                                    📸 {photo.s3Url}
                                </p>
                            </div>

                            {/* Observations */}
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '8px', fontSize: '15px' }}>
                                    Observations:
                                </label>
                                <textarea
                                    value={editingTexts[`${photo.id}-observation`] || ''}
                                    onChange={(e) => handleTextChange(e, photo.id, 'observation')}
                                    onBlur={() => handleTextBlur(photo.id, 'observation')}
                                    onKeyDown={(e) => handleKeyDown(e, photo.id, 'observation')}
                                    style={{
                                        width: '100%',
                                        minHeight: '180px',
                                        padding: '12px',
                                        fontFamily: 'monospace',
                                        fontSize: '14px',
                                        lineHeight: '1.6',
                                        borderRadius: '4px',
                                        border: '1px solid #ccc',
                                        resize: 'vertical'
                                    }}
                                />
                            </div>

                            {/* Recommandations */}
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '8px', fontSize: '15px' }}>
                                    Recommandations:
                                </label>
                                <textarea
                                    value={editingTexts[`${photo.id}-recommendation`] || ''}
                                    onChange={(e) => handleTextChange(e, photo.id, 'recommendation')}
                                    onBlur={() => handleTextBlur(photo.id, 'recommendation')}
                                    onKeyDown={(e) => handleKeyDown(e, photo.id, 'recommendation')}
                                    style={{
                                        width: '100%',
                                        minHeight: '180px',
                                        padding: '12px',
                                        fontFamily: 'monospace',
                                        fontSize: '14px',
                                        lineHeight: '1.6',
                                        borderRadius: '4px',
                                        border: '1px solid #ccc',
                                        resize: 'vertical'
                                    }}
                                />
                            </div>

                            {/* Références */}
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '8px', fontSize: '15px' }}>
                                    🏛️ Références:
                                </label>
                                <textarea
                                    value={editingTexts[`${photo.id}-references`] || ''}
                                    onChange={(e) => handleTextChange(e, photo.id, 'references')}
                                    onBlur={() => handleTextBlur(photo.id, 'references')}
                                    onKeyDown={(e) => handleKeyDown(e, photo.id, 'references')}
                                    style={{
                                        width: '100%',
                                        minHeight: '120px',
                                        padding: '12px',
                                        fontFamily: 'monospace',
                                        fontSize: '14px',
                                        lineHeight: '1.6',
                                        borderRadius: '4px',
                                        border: '1px solid #ccc',
                                        resize: 'vertical'
                                    }}
                                />
                            </div>

                            {/* Commentaires */}
                            <div style={{ marginBottom: '15px' }}>
                                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '8px', fontSize: '15px' }}>
                                    💬 Commentaires du coordonnateur:
                                </label>
                                <textarea
                                    value={photo.comment}
                                    onChange={(e) => handleCommentChange(e, photo.id)}
                                    placeholder="Ajouter un commentaire..."
                                    style={{
                                        width: '100%',
                                        minHeight: '100px',
                                        padding: '12px',
                                        fontFamily: 'monospace',
                                        fontSize: '14px',
                                        lineHeight: '1.6',
                                        borderRadius: '4px',
                                        border: '1px solid #ccc',
                                        resize: 'vertical'
                                    }}
                                />
                            </div>
                        </div>
                    ))}

                    {/* Édition Footer */}
                    <div style={{ marginTop: '30px', border: '1px solid #ddd', borderRadius: '8px', padding: '20px', backgroundColor: '#f0f8ff' }}>
                        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                            📄 Pied de page du rapport:
                        </label>
                        <textarea
                            value={footer}
                            onChange={(e) => setFooter(e.target.value)}
                            placeholder="Ajouter un pied de page (optionnel)..."
                            style={{
                                width: '100%',
                                minHeight: '150px',
                                padding: '10px',
                                fontFamily: 'monospace',
                                fontSize: '14px',
                                borderRadius: '4px',
                                border: '1px solid #ccc',
                                resize: 'vertical'
                            }}
                        />
                    </div>
                </div>
            ) : (
                /* Mode Lecture */
                <div style={{
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'monospace',
                    lineHeight: '1.6',
                    backgroundColor: '#ffffff',
                    padding: '20px',
                    borderRadius: '8px',
                    border: '1px solid #ddd'
                }}>
                    {/* Header */}
                    {header && (
                        <>
                            {header}
                            {'\n\n'}
                        </>
                    )}

                    {/* Content principal */}
                    OBSERVATIONS PRINCIPALES:
                    {'\n'}
                    {photos.map((photo, index) => (
                        <div key={photo.id}>
                            {'━'.repeat(25)}
                            {'\n'}
                            Photo {index + 1} - Niveau de risque: {getRiskLevelLabel(photo.analysis.riskLevel)}
                            {'\n'}
                            📸 Photo: {photo.s3Url}
                            {'\n\n'}
                            {base64Images[photo.id] ? (
                                <img
                                    src={base64Images[photo.id]}
                                    alt={`Photo ${index + 1}`}
                                    style={{
                                        maxWidth: '600px',
                                        width: '100%',
                                        height: 'auto',
                                        margin: '10px 0',
                                        borderRadius: '4px',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                    }}
                                    onError={(e) => {
                                        console.error('Erreur chargement image lecture:', photo.id);
                                        e.target.style.display = 'none';
                                    }}
                                />
                            ) : null}
                            {'\n\n'}
                            Observations:
                            {'\n'}
                            {photo.analysis.observation.map((obs, i) => `• ${obs}\n`).join('')}
                            {'\n'}
                            Recommandations:
                            {'\n'}
                            {photo.analysis.recommendation.map((rec, i) => `• ${rec}\n`).join('')}
                            {'\n'}
                            🏛️ Références:
                            {'\n'}
                            {photo.analysis.references.map((ref, i) => `• ${ref}\n`).join('')}
                            {'\n'}
                            💬 Commentaires du coordonnateur:
                            {'\n'}
                            {photo.comment || ''}
                            {'\n\n'}
                        </div>
                    ))}

                    {/* Footer */}
                    {footer && (
                        <>
                            {'\n'}
                            {footer}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

export default PhotoReportEditor;
