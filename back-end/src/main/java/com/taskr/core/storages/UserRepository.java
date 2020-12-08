package com.taskr.core.storages;

import com.taskr.core.resources.User;
import org.springframework.data.repository.CrudRepository;

public interface UserRepository extends CrudRepository<User, Long> {
}
