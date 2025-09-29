terraform{
  required_version = "1.7.0"
  required_providers {
    aws = {
      source  = "hashicorp/azurerm"
      version = "~>3.0"
      }
    random = {
      source = "hashicorp/random"
      version = "~>3.0"
     }
    }
   } 
