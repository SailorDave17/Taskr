package com.taskr.core.storages;

import com.taskr.core.Resources.User;
import org.springframework.data.repository.CrudRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface UserRepository extends CrudRepository<User, Long> {
    User findUserByName(String name);
}
