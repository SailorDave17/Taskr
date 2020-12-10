package com.taskr.core.storage.repository;

import com.taskr.core.model.User;
import org.springframework.data.repository.CrudRepository;

public interface UserRepository extends CrudRepository<User, Long> {
}
