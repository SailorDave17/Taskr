package com.taskr.core.Storages;

import com.taskr.core.Resources.User;
import org.springframework.data.repository.CrudRepository;

public interface UserRepository extends CrudRepository<User, Long> {
}
