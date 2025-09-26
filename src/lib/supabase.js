import { createClient } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const storageS3Endpoint = import.meta.env.VITE_STORAGE_S3_ENDPOINT
const storageRegion = import.meta.env.VITE_STORAGE_REGION
const accessKeyId = import.meta.env.VITE_ACCESS_KEY_ID
const accessKey = import.meta.env.VITE_ACCESS_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.')
}

// Configure Supabase client with S3-compatible storage
const supabaseOptions = {}

if (storageS3Endpoint && storageRegion) {
  supabaseOptions.storage = {
    endpoint: storageS3Endpoint,
    region: storageRegion,
    forcePathStyle: true // Required for S3-compatible endpoints
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, supabaseOptions)

// S3 client for direct uploads (fallback option)
const s3Client = accessKeyId && accessKey && storageS3Endpoint ? new S3Client({
  endpoint: storageS3Endpoint,
  region: storageRegion || 'ap-south-1',
  credentials: {
    accessKeyId,
    secretAccessKey: accessKey,
  },
  forcePathStyle: true,
}) : null

// Database operations
export const db = {
  // Create or update a paste entry
  async createOrUpdateEntry(data, passcode) {
    if (data.is_guest) {
      // Guest mode: upsert a single shared entry
      const { data: entry, error } = await supabase
        .from('entries')
        .upsert({
          slug: 'guest-paste', // Fixed slug for the shared guest paste
          content: data.content,
          is_guest: true,
          updated_at: new Date().toISOString()
        }, { onConflict: 'slug' })
        .select()
        .single();

      if (error) throw error;
      return entry;
    }
    
    if (passcode) {
      // For passcode mode: check if entry exists, if yes update it, if no create it
      const { data: existingEntry, error: fetchError } = await supabase
        .from('entries')
        .select('*')
        .eq('passcode', passcode)
        .single()

      if (existingEntry) {
        // Update existing entry
        const { data: updatedEntry, error: updateError } = await supabase
          .from('entries')
          .update({
            content: data.content,
            updated_at: new Date().toISOString()
          })
          .eq('passcode', passcode)
          .select()
          .single()
        
        if (updateError) throw updateError
        return updatedEntry
      } else {
        // Create new entry with passcode
        const { data: newEntry, error: createError } = await supabase
          .from('entries')
          .insert([{
            ...data,
            passcode: passcode
          }])
          .select()
          .single()
        
        if (createError) throw createError
        return newEntry
      }
    }

    // Fallback for old guest mode or other cases - create a new entry
    const { data: entry, error } = await supabase
      .from('entries')
      .insert([data])
      .select()
      .single()
    
    if (error) throw error
    return entry
  },

  async getEntry(slug) {
    const { data: entry, error } = await supabase
      .from('entries')
      .select(`
        *,
        files (*)
      `)
      .eq('slug', slug)
      .single()
    
    if (error) throw error
    return entry
  },

  async getEntryByPasscode(passcode) {
    const { data: entry, error } = await supabase
      .from('entries')
      .select(`
        *,
        files (*)
      `)
      .eq('passcode', passcode)
      .single()
    
    if (error && error.code !== 'PGRST116') throw error // PGRST116 = not found
    return entry
  },

  // Delete entry (only for passcode mode)
  async deleteEntry(id) {
    const { error } = await supabase
      .from('entries')
      .delete()
      .eq('id', id)
    
    if (error) throw error
  },

  // Clear content of entry (alternative to delete)
  async clearEntry(passcode) {
    const { data: clearedEntry, error } = await supabase
      .from('entries')
      .update({ 
        content: '',
        updated_at: new Date().toISOString()
      })
      .eq('passcode', passcode)
      .select()
      .single()
    
    if (error) throw error
    return clearedEntry
  },

  // Upload file to storage
  async uploadFile(file, entryId) {
    const bucketName = 'paste'
    const fileExt = file.name.split('.').pop()
    const fileName = `${entryId}_${Date.now()}.${fileExt}`
    const filePath = `uploads/${fileName}` // Keep uploads folder structure

    // Simple Supabase storage upload
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(filePath, file)

    if (error) {
      console.error('Upload error:', error)
      // If bucket doesn't exist, provide helpful error
      if (error.message?.includes('Bucket not found')) {
        throw new Error(`Storage bucket '${bucketName}' not found. Please create it in your Supabase dashboard under Storage.`)
      }
      throw error
    }

    console.log("Uploaded:", data)

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from(bucketName)
      .getPublicUrl(filePath)

    // Save file record
    const { data: fileRecord, error: fileError } = await supabase
      .from('files')
      .insert([{
        entry_id: entryId,
        file_url: publicUrl,
        file_name: file.name,
        file_size: file.size
      }])
      .select()
      .single()

    if (fileError) throw fileError
    return { ...fileRecord, publicUrl }
  },

  // Alternative S3 upload using AWS SDK (fallback if Supabase storage fails)
  async uploadFileS3(file, entryId) {
    if (!s3Client) {
      throw new Error('S3 client not configured. Missing AWS credentials in environment variables.')
    }

    const bucketName = 'paste'
    const fileExt = file.name.split('.').pop()
    const fileName = `${entryId}_${Date.now()}.${fileExt}`
    const filePath = `uploads/${fileName}`

    try {
      // Upload to S3 directly
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: filePath,
        Body: file,
        ContentType: file.type,
        ACL: 'public-read'
      })

      await s3Client.send(command)

      // Construct public URL
      const publicUrl = `${storageS3Endpoint.replace('/s3', '')}/object/public/${bucketName}/${filePath}`

      // Save file record
      const { data: fileRecord, error: fileError } = await supabase
        .from('files')
        .insert([{
          entry_id: entryId,
          file_url: publicUrl,
          file_name: file.name,
          file_size: file.size
        }])
        .select()
        .single()

      if (fileError) throw fileError
      return { ...fileRecord, publicUrl }
    } catch (error) {
      console.error('S3 upload error:', error)
      throw error
    }
  },

  // Delete a file from both storage and database
  async deleteFile(fileId) {
    try {
      // First, get the file record to extract the file path from URL
      const { data: fileRecord, error: fetchError } = await supabase
        .from('files')
        .select('*')
        .eq('id', fileId)
        .single()

      // Handle PostgREST not-found error with friendly message
      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          throw new Error('File not found')
        }
        throw fetchError
      }
      if (!fileRecord) throw new Error('File not found')

      // Extract file path from the public URL using URL parsing
      // URL format: https://[project-ref].supabase.co/storage/v1/object/public/paste/[file-path]
      const url = new URL(fileRecord.file_url)
      const pathParts = url.pathname.split('/storage/v1/object/public/paste/')
      if (pathParts.length !== 2) throw new Error('Invalid file URL format')
      const filePath = pathParts[1]

      // Delete file from storage bucket
      const { error: storageError } = await supabase.storage
        .from('paste')
        .remove([filePath])

      // Treat storage 'object not found' as non-fatal so DB record can still be cleaned up
      if (storageError && !storageError.message?.includes('not found')) {
        throw storageError
      }

      // Delete file record from database
      const { error: dbError } = await supabase
        .from('files')
        .delete()
        .eq('id', fileId)

      if (dbError) throw dbError

      // Return deleted file info to aid callers updating UI state
      return { success: true, id: fileId, deletedFile: fileRecord }
    } catch (error) {
      console.error('Error deleting file:', error)
      throw error
    }
  },

  // Increment view count for an entry
  async incrementViews(slug) {
    const { error } = await supabase
      .from('entries')
      .update({ 
        views: supabase.sql`views + 1`
      })
      .eq('slug', slug)
    
    if (error) {
      console.warn('Failed to increment views:', error)
      // Don't throw error, views are not critical
    }
  },

  // Clean up expired guest entries (called by Supabase cron)
  async cleanupExpiredEntries() {
    const { error } = await supabase
      .from('entries')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .eq('is_guest', true)
    
    if (error) throw error
  },

}

// Utility functions
export const utils = {
  // Generate unique slug
  generateSlug(length = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  },

  // Check if file is image
  isImageFile(fileName) {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']
    const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'))
    return imageExtensions.includes(ext)
  },

  // Format file size
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  },

  // Copy to clipboard
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (err) {
      console.error('Failed to copy: ', err)
      return false
    }
  }
}
